"""S3 utility functions using Boto3."""

import csv
import io
import json
import logging
from typing import Dict, Generator, List, Optional, Tuple

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def get_s3_client():
    """Get a configured S3 client."""
    return boto3.client('s3')


def download_pdf_bytes(bucket: str, key: str, client=None) -> Optional[bytes]:
    """Download PDF bytes from S3.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        client: Optional pre-configured S3 client

    Returns:
        PDF bytes or None if download failed
    """
    client = client or get_s3_client()

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        return response['Body'].read()
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        if error_code == '404' or error_code == 'NoSuchKey':
            logger.warning(f"Object not found: s3://{bucket}/{key}")
        else:
            logger.error(f"Failed to download s3://{bucket}/{key}: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error downloading s3://{bucket}/{key}: {e}")
        return None


def upload_jsonl(
    bucket: str,
    key: str,
    records: List[dict],
    client=None
) -> bool:
    """Upload records as JSONL to S3.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        records: List of dictionaries to write
        client: Optional pre-configured S3 client

    Returns:
        True if upload succeeded
    """
    client = client or get_s3_client()

    try:
        jsonl_content = '\n'.join(json.dumps(record) for record in records)
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=jsonl_content.encode('utf-8'),
            ContentType='application/x-ndjson'
        )
        logger.info(f"Uploaded {len(records)} records to s3://{bucket}/{key}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload to s3://{bucket}/{key}: {e}")
        return False


def upload_json(
    bucket: str,
    key: str,
    data: dict,
    client=None
) -> bool:
    """Upload a single JSON object to S3.

    Args:
        bucket: S3 bucket name
        key: S3 object key
        data: Dictionary to write as JSON
        client: Optional pre-configured S3 client

    Returns:
        True if upload succeeded
    """
    client = client or get_s3_client()

    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(data, ensure_ascii=False).encode('utf-8'),
            ContentType='application/json'
        )
        return True
    except Exception as e:
        logger.error(f"Failed to upload JSON to s3://{bucket}/{key}: {e}")
        return False


def stream_manifest_range(
    bucket: str,
    key: str,
    start_row: int,
    end_row: int,
    client=None
) -> Generator[Tuple[str, str, Dict], None, None]:
    """Stream a range of rows from a CSV manifest file.

    The manifest CSV is expected to have columns: bucket, key
    Optional metadata columns: company_id, company_name, filing_date, filing_type, title

    Args:
        bucket: S3 bucket containing the manifest
        key: S3 key of the manifest CSV
        start_row: Starting row index (0-based, excluding header)
        end_row: Ending row index (exclusive)
        client: Optional pre-configured S3 client

    Yields:
        Tuples of (bucket, key, metadata_dict) for each row in range
    """
    client = client or get_s3_client()

    # Metadata columns to extract from manifest
    metadata_columns = [
        'company_id', 'company_name', 'filing_date', 'filing_type',
        'title', 'source_id', 'exchange', 'report_date'
    ]

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')

        reader = csv.DictReader(io.StringIO(content))

        for idx, row in enumerate(reader):
            if idx < start_row:
                continue
            if idx >= end_row:
                break

            # Support both 'bucket'/'key' and 's3_bucket'/'s3_key' column names
            row_bucket = row.get('bucket') or row.get('s3_bucket', '')
            row_key = row.get('key') or row.get('s3_key', '')

            # Extract metadata from row if present
            metadata = {}
            for col in metadata_columns:
                if col in row and row[col]:
                    metadata[col] = row[col]

            # Use report_date as filing_date if filing_date not set
            if 'report_date' in metadata and 'filing_date' not in metadata:
                metadata['filing_date'] = metadata.pop('report_date')

            if row_bucket and row_key:
                yield (row_bucket, row_key, metadata)
            else:
                logger.warning(f"Invalid manifest row {idx}: {row}")

    except Exception as e:
        logger.error(f"Failed to read manifest s3://{bucket}/{key}: {e}")
        raise


def load_metadata_lookup(
    bucket: str,
    key: str,
    client=None
) -> Dict[str, Dict]:
    """Load a metadata lookup JSON file from S3.

    The JSON file should be a dict mapping source_id to metadata:
    {
        "20241201000123": {
            "company_id": "00123456",
            "company_name": "Example Corp",
            "filing_date": "2024-12-01",
            "filing_type": "annual_report",
            "title": "Annual Report 2024"
        },
        ...
    }

    Args:
        bucket: S3 bucket containing the lookup file
        key: S3 key of the lookup JSON
        client: Optional pre-configured S3 client

    Returns:
        Dictionary mapping source_id to metadata dict
    """
    client = client or get_s3_client()

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        if error_code == '404' or error_code == 'NoSuchKey':
            logger.info(f"Metadata lookup not found: s3://{bucket}/{key}")
            return {}
        logger.error(f"Failed to load metadata lookup: {e}")
        return {}
    except Exception as e:
        logger.error(f"Failed to parse metadata lookup: {e}")
        return {}


def count_manifest_rows(bucket: str, key: str, client=None) -> int:
    """Count total rows in a manifest CSV (excluding header).

    Args:
        bucket: S3 bucket containing the manifest
        key: S3 key of the manifest CSV
        client: Optional pre-configured S3 client

    Returns:
        Number of data rows in the manifest
    """
    client = client or get_s3_client()

    try:
        response = client.get_object(Bucket=bucket, Key=key)
        content = response['Body'].read().decode('utf-8')

        reader = csv.DictReader(io.StringIO(content))
        return sum(1 for _ in reader)
    except Exception as e:
        logger.error(f"Failed to count manifest rows: {e}")
        raise
