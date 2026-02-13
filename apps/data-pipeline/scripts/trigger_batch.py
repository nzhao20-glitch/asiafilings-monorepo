#!/usr/bin/env python3
"""
Trigger AWS Batch array job for filing ETL processing.

Usage:
    python trigger_batch.py --manifest-bucket <bucket> --manifest-key <key>

Environment Variables:
    AWS_REGION: AWS region (default: ap-northeast-2)
    BATCH_JOB_QUEUE: Batch job queue name
    BATCH_JOB_DEFINITION: Batch job definition name
    CHUNK_SIZE: Files per job (default: 1000)
"""

import argparse
import logging
import math
import os
import sys

import boto3

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def count_manifest_rows(s3_client, bucket: str, key: str) -> int:
    """Count rows in manifest CSV (excluding header)."""
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response['Body'].read().decode('utf-8')
    lines = content.strip().split('\n')
    # Subtract 1 for header
    return max(0, len(lines) - 1)


def submit_batch_job(
    batch_client,
    job_queue: str,
    job_definition: str,
    manifest_bucket: str,
    manifest_key: str,
    array_size: int,
    chunk_size: int,
    exchange: str = "",
    job_name: str = "filing-etl"
) -> dict:
    """Submit AWS Batch array job."""

    # Environment variable overrides
    env_overrides = [
        {"name": "MANIFEST_BUCKET", "value": manifest_bucket},
        {"name": "MANIFEST_KEY", "value": manifest_key},
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

    # Initialize AWS clients
    s3_client = boto3.client("s3", region_name=args.region)
    batch_client = boto3.client("batch", region_name=args.region)

    # Count files in manifest
    logger.info(f"Reading manifest: s3://{args.manifest_bucket}/{args.manifest_key}")
    total_files = count_manifest_rows(s3_client, args.manifest_bucket, args.manifest_key)
    logger.info(f"Total files in manifest: {total_files}")

    if total_files == 0:
        logger.error("Manifest is empty, nothing to process")
        sys.exit(1)

    # Calculate array size
    array_size = math.ceil(total_files / args.chunk_size)
    logger.info(f"Chunk size: {args.chunk_size}")
    logger.info(f"Array size (number of jobs): {array_size}")

    if args.dry_run:
        logger.info("DRY RUN - Job parameters:")
        logger.info(f"  Job Queue: {args.job_queue}")
        logger.info(f"  Job Definition: {args.job_definition}")
        logger.info(f"  Manifest: s3://{args.manifest_bucket}/{args.manifest_key}")
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
        manifest_key=args.manifest_key,
        array_size=array_size,
        chunk_size=args.chunk_size,
        exchange=args.exchange,
        job_name=args.job_name
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
