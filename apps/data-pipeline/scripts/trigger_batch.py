#!/usr/bin/env python3
"""
Trigger AWS Batch array job for filing ETL processing.

Splits the manifest CSV into per-job chunks and uploads them to S3,
so each Batch job only downloads its own small chunk (~1000 rows)
instead of the full manifest.

Usage:
    python trigger_batch.py --manifest-bucket <bucket> --manifest-key <key>

Environment Variables:
    AWS_REGION: AWS region (default: ap-east-1)
    BATCH_JOB_QUEUE: Batch job queue name
    BATCH_JOB_DEFINITION: Batch job definition name
    CHUNK_SIZE: Files per job (default: 1000)
"""

import argparse
import csv
import io
import logging
import math
import os
import sys
import time

import boto3

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def split_and_upload_manifest(
    s3_client,
    bucket: str,
    key: str,
    chunk_size: int,
    prefix: str,
) -> int:
    """Split manifest into per-job chunks and upload to S3.

    Each chunk is a valid CSV with headers, containing up to chunk_size rows.
    Streams through the manifest one chunk at a time to limit memory usage.

    Args:
        s3_client: Boto3 S3 client
        bucket: S3 bucket containing the manifest
        key: S3 key of the full manifest CSV
        chunk_size: Number of rows per chunk
        prefix: S3 key prefix for uploaded chunks

    Returns:
        Number of chunks created (= array size)
    """
    logger.info(f"Downloading manifest: s3://{bucket}/{key}")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response['Body'].read().decode('utf-8')

    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames

    chunk_index = 0
    chunk_rows = []

    for row in reader:
        chunk_rows.append(row)
        if len(chunk_rows) >= chunk_size:
            _upload_chunk(s3_client, bucket, prefix, chunk_index, headers, chunk_rows)
            chunk_index += 1
            chunk_rows = []

    if chunk_rows:
        _upload_chunk(s3_client, bucket, prefix, chunk_index, headers, chunk_rows)
        chunk_index += 1

    return chunk_index


def _upload_chunk(
    s3_client,
    bucket: str,
    prefix: str,
    chunk_index: int,
    headers: list,
    rows: list,
):
    """Upload a single chunk CSV to S3."""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    writer.writerows(rows)

    chunk_key = f"{prefix}/chunk_{chunk_index:06d}.csv"
    s3_client.put_object(
        Bucket=bucket,
        Key=chunk_key,
        Body=output.getvalue().encode('utf-8'),
        ContentType='text/csv',
    )

    if (chunk_index + 1) % 100 == 0:
        logger.info(f"Uploaded chunk {chunk_index + 1}")


def submit_batch_job(
    batch_client,
    job_queue: str,
    job_definition: str,
    manifest_bucket: str,
    manifest_prefix: str,
    array_size: int,
    chunk_size: int,
    exchange: str = "",
    job_name: str = "filing-etl",
) -> dict:
    """Submit AWS Batch array job."""

    env_overrides = [
        {"name": "MANIFEST_BUCKET", "value": manifest_bucket},
        {"name": "MANIFEST_PREFIX", "value": manifest_prefix},
        {"name": "CHUNK_SIZE", "value": str(chunk_size)},
    ]

    if exchange:
        env_overrides.append({"name": "EXCHANGE", "value": exchange})

    submit_params = {
        "jobName": job_name,
        "jobQueue": job_queue,
        "jobDefinition": job_definition,
        "containerOverrides": {
            "environment": env_overrides
        }
    }

    # Use array job if more than 1 chunk
    if array_size > 1:
        submit_params["arrayProperties"] = {"size": array_size}

    response = batch_client.submit_job(**submit_params)
    return response


def main():
    parser = argparse.ArgumentParser(
        description="Trigger AWS Batch job for filing ETL"
    )
    parser.add_argument(
        "--manifest-bucket",
        required=True,
        help="S3 bucket containing the manifest CSV"
    )
    parser.add_argument(
        "--manifest-key",
        required=True,
        help="S3 key of the manifest CSV"
    )
    parser.add_argument(
        "--job-queue",
        default=os.environ.get("BATCH_JOB_QUEUE", "filing-etl-dev-queue"),
        help="Batch job queue name"
    )
    parser.add_argument(
        "--job-definition",
        default=os.environ.get("BATCH_JOB_DEFINITION", "filing-etl-dev-etl-worker"),
        help="Batch job definition name"
    )
    parser.add_argument(
        "--chunk-size",
        type=int,
        default=int(os.environ.get("CHUNK_SIZE", "1000")),
        help="Number of files per batch job"
    )
    parser.add_argument(
        "--exchange",
        default="",
        help="Exchange identifier (e.g., DART, HKEX)"
    )
    parser.add_argument(
        "--job-name",
        default="filing-etl",
        help="Job name prefix"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print job parameters without submitting"
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "ap-east-1"),
        help="AWS region"
    )

    args = parser.parse_args()

    s3_client = boto3.client("s3", region_name=args.region)
    batch_client = boto3.client("batch", region_name=args.region)

    # Split manifest into per-job chunks and upload to S3
    manifest_prefix = f"manifests/{args.job_name}-{int(time.time())}"

    logger.info(f"Splitting manifest into chunks of {args.chunk_size}...")
    array_size = split_and_upload_manifest(
        s3_client,
        args.manifest_bucket,
        args.manifest_key,
        args.chunk_size,
        manifest_prefix,
    )
    logger.info(f"Uploaded {array_size} chunks to s3://{args.manifest_bucket}/{manifest_prefix}/")

    if array_size == 0:
        logger.error("Manifest is empty, nothing to process")
        sys.exit(1)

    if args.dry_run:
        logger.info("DRY RUN - Job parameters:")
        logger.info(f"  Job Queue: {args.job_queue}")
        logger.info(f"  Job Definition: {args.job_definition}")
        logger.info(f"  Manifest prefix: s3://{args.manifest_bucket}/{manifest_prefix}/")
        logger.info(f"  Array Size: {array_size}")
        logger.info(f"  Exchange: {args.exchange or 'not set'}")
        return

    # Submit job
    logger.info("Submitting Batch job...")
    response = submit_batch_job(
        batch_client=batch_client,
        job_queue=args.job_queue,
        job_definition=args.job_definition,
        manifest_bucket=args.manifest_bucket,
        manifest_prefix=manifest_prefix,
        array_size=array_size,
        chunk_size=args.chunk_size,
        exchange=args.exchange,
        job_name=args.job_name,
    )

    job_id = response["jobId"]
    logger.info(f"Job submitted successfully!")
    logger.info(f"  Job ID: {job_id}")
    logger.info(f"  Job Name: {response['jobName']}")

    # Print monitoring command
    print(f"\nMonitor job status with:")
    print(f"  aws batch describe-jobs --jobs {job_id}")


if __name__ == "__main__":
    main()
