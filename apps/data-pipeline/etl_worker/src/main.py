"""Main entry point for the Filing ETL Worker.

This worker processes PDF/HTML filings from S3, extracts text with
position mapping, and outputs JSONL files for indexing by Quickwit.

Environment Variables:
    AWS_BATCH_JOB_ARRAY_INDEX: Array job index (default: 0)
    AWS_BATCH_JOB_ID: Batch job ID (set by AWS Batch)
    CHUNK_SIZE: Number of files per batch job (default: 1000)
    MANIFEST_BUCKET: S3 bucket containing the manifest CSV
    MANIFEST_KEY: S3 key of the manifest CSV
    OUTPUT_BUCKET: S3 bucket for processed JSONL output
    OUTPUT_PREFIX: S3 key prefix for output files (default: 'processed')
    EXCHANGE: Exchange identifier (optional, e.g., 'DART', 'HKEX')
    METADATA_BUCKET: S3 bucket for metadata lookup JSON (optional)
    METADATA_KEY: S3 key for metadata lookup JSON (optional)
    ENABLE_JOB_TRACKING: Set to 'true' to enable DynamoDB job tracking
    LOG_LEVEL: Logging level (default: 'INFO')
"""

import json
import logging
import os
import sys
from pathlib import Path

from dynamo_utils import (
    batch_check_processed,
    batch_record_processed,
    record_failed,
    record_file_error,
    record_job_complete,
    record_job_start,
)
from extractor import process_document_bytes
from s3_utils import (
    download_pdf_bytes,
    get_s3_client,
    load_metadata_lookup,
    stream_manifest_range,
    upload_jsonl,
)

# Configure logging
log_level = os.environ.get('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(
    level=getattr(logging, log_level, logging.INFO),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_config() -> dict:
    """Load configuration from environment variables."""
    return {
        'job_id': os.environ.get('AWS_BATCH_JOB_ID', f"local-{os.getpid()}"),
        'job_index': int(os.environ.get('AWS_BATCH_JOB_ARRAY_INDEX', '0')),
        'chunk_size': int(os.environ.get('CHUNK_SIZE', '1000')),
        'manifest_bucket': os.environ.get('MANIFEST_BUCKET', ''),
        'manifest_key': os.environ.get('MANIFEST_KEY', ''),
        'output_bucket': os.environ.get('OUTPUT_BUCKET', ''),
        'output_prefix': os.environ.get('OUTPUT_PREFIX', 'processed'),
        'exchange': os.environ.get('EXCHANGE', ''),
        'metadata_bucket': os.environ.get('METADATA_BUCKET', ''),
        'metadata_key': os.environ.get('METADATA_KEY', ''),
        'enable_tracking': os.environ.get('ENABLE_JOB_TRACKING', '').lower() == 'true',
        'enable_dedup': os.environ.get('ENABLE_DEDUP', '').lower() == 'true',
    }


def validate_config(config: dict) -> bool:
    """Validate required configuration."""
    required = ['manifest_bucket', 'manifest_key', 'output_bucket']
    missing = [k for k in required if not config.get(k)]

    if missing:
        logger.error(f"Missing required environment variables: {missing}")
        return False
    return True


def process_batch(config: dict) -> dict:
    """Process a batch of documents based on job array index.

    Args:
        config: Configuration dictionary

    Returns:
        Dictionary with processing statistics
    """
    job_id = config['job_id']
    job_index = config['job_index']
    chunk_size = config['chunk_size']
    exchange = config['exchange'] or None
    enable_tracking = config['enable_tracking']
    enable_dedup = config['enable_dedup']

    # Calculate row range for this batch
    start_row = job_index * chunk_size
    end_row = start_row + chunk_size

    logger.info(f"Processing batch {job_index}: rows {start_row} to {end_row}")

    s3_client = get_s3_client()
    all_pages = []
    processed_items = []  # For dedup recording
    stats = {
        'files_processed': 0,
        'files_failed': 0,
        'files_skipped': 0,
        'pages_extracted': 0,
    }

    # Load optional metadata lookup
    metadata_lookup = {}
    if config['metadata_bucket'] and config['metadata_key']:
        logger.info(f"Loading metadata lookup from s3://{config['metadata_bucket']}/{config['metadata_key']}")
        metadata_lookup = load_metadata_lookup(
            config['metadata_bucket'],
            config['metadata_key'],
            client=s3_client
        )
        logger.info(f"Loaded {len(metadata_lookup)} metadata entries")

    # Stream manifest and process each file
    try:
        manifest_rows = list(stream_manifest_range(
            config['manifest_bucket'],
            config['manifest_key'],
            start_row,
            end_row,
            client=s3_client
        ))
    except Exception as e:
        logger.error(f"Failed to read manifest: {e}")
        return stats

    logger.info(f"Found {len(manifest_rows)} files to process in this batch")

    # Dedup pre-check: skip already-completed filings
    already_processed = set()
    if enable_dedup and exchange:
        all_source_ids = [Path(key).stem.rstrip('.') for _, key, _ in manifest_rows]
        already_processed = batch_check_processed(exchange, all_source_ids)
        if already_processed:
            logger.info(f"Dedup: {len(already_processed)}/{len(manifest_rows)} filings already processed, will skip")

    for idx, (bucket, key, row_metadata) in enumerate(manifest_rows):
        try:
            # Extract filename and source_id from key
            filename = Path(key).name
            source_id = Path(key).stem.rstrip('.')

            # Skip already-processed filings
            if source_id in already_processed:
                stats['files_skipped'] += 1
                continue

            # Download document (PDF, HTML, etc.)
            doc_bytes = download_pdf_bytes(bucket, key, client=s3_client)
            if doc_bytes is None:
                stats['files_failed'] += 1
                if enable_tracking:
                    record_file_error(job_id, key, 'DOWNLOAD_FAILED', 'Failed to download file')
                if enable_dedup and exchange:
                    record_failed(exchange, source_id, key, 'Failed to download file', job_id)
                continue

            # Merge metadata: row metadata + lookup metadata
            file_metadata = {**row_metadata}
            if source_id in metadata_lookup:
                file_metadata.update(metadata_lookup[source_id])

            # Process document - auto-detects PDF/HTML and extracts text
            pages, error = process_document_bytes(
                doc_bytes,
                filename,
                s3_key=key,
                exchange=exchange,
                document_id=source_id,
                metadata=file_metadata
            )

            if error:
                if enable_tracking:
                    record_file_error(job_id, key, 'EXTRACTION_FAILED', error)

            all_pages.extend(pages)
            stats['files_processed'] += 1
            stats['pages_extracted'] += len(pages)

            # Track for dedup recording
            if enable_dedup and exchange:
                processed_items.append({
                    'source_id': source_id,
                    's3_key': key,
                    'pages_extracted': len(pages),
                })

            if (idx + 1) % 100 == 0:
                logger.info(f"Progress: {idx + 1}/{len(manifest_rows)} files processed "
                            f"({stats['files_skipped']} skipped)")

        except Exception as e:
            logger.error(f"Failed to process s3://{bucket}/{key}: {e}")
            stats['files_failed'] += 1
            if enable_tracking:
                record_file_error(job_id, key, 'PROCESSING_ERROR', str(e))
            if enable_dedup and exchange:
                source_id = Path(key).stem.rstrip('.')
                record_failed(exchange, source_id, key, str(e), job_id)

    # Upload results in chunks of ~10MB
    if all_pages:
        exchange_prefix = (exchange or "unknown").lower()
        max_bytes = 10 * 1024 * 1024  # 10MB
        chunk = []
        chunk_bytes = 0
        part = 0

        for page in all_pages:
            line = json.dumps(page)
            line_bytes = len(line.encode('utf-8')) + 1  # +1 for newline
            if chunk and chunk_bytes + line_bytes > max_bytes:
                output_key = f"{config['output_prefix']}/{exchange_prefix}/batch_{job_index:06d}_{part:03d}.jsonl"
                if not upload_jsonl(config['output_bucket'], output_key, chunk, client=s3_client):
                    logger.error(f"Failed to upload {output_key}")
                part += 1
                chunk = []
                chunk_bytes = 0
            chunk.append(page)
            chunk_bytes += line_bytes

        if chunk:
            output_key = f"{config['output_prefix']}/{exchange_prefix}/batch_{job_index:06d}_{part:03d}.jsonl"
            if not upload_jsonl(config['output_bucket'], output_key, chunk, client=s3_client):
                logger.error(f"Failed to upload {output_key}")
    else:
        logger.warning("No pages extracted, skipping upload")

    # Record processed filings for dedup
    if enable_dedup and exchange and processed_items:
        batch_record_processed(exchange, processed_items, job_id)

    logger.info(f"Batch {job_index} complete: {stats}")
    return stats


def main():
    """Main entry point."""
    logger.info("Starting Filing ETL Worker")

    config = get_config()
    logger.info(f"Configuration: job_id={config['job_id']}, job_index={config['job_index']}, "
                f"chunk_size={config['chunk_size']}, exchange={config['exchange'] or 'not set'}, "
                f"tracking={'enabled' if config['enable_tracking'] else 'disabled'}, "
                f"dedup={'enabled' if config['enable_dedup'] else 'disabled'}")

    if not validate_config(config):
        sys.exit(1)

    # Record job start
    if config['enable_tracking']:
        start_row = config['job_index'] * config['chunk_size']
        end_row = start_row + config['chunk_size']
        record_job_start(
            config['job_id'],
            config['exchange'],
            config['manifest_key'],
            start_row,
            end_row
        )

    try:
        stats = process_batch(config)

        # Record job completion
        if config['enable_tracking']:
            if stats['files_failed'] > 0 and stats['files_processed'] == 0:
                record_job_complete(config['job_id'], stats, 'FAILED', 'All files failed to process')
            else:
                record_job_complete(config['job_id'], stats, 'SUCCEEDED')

        if stats['files_failed'] > 0 and stats['files_processed'] == 0:
            logger.error("All files failed to process")
            sys.exit(1)

        logger.info("Worker completed successfully")

    except Exception as e:
        logger.exception(f"Worker failed with error: {e}")
        if config['enable_tracking']:
            record_job_complete(config['job_id'], {}, 'FAILED', str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
