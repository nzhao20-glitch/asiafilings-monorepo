#!/usr/bin/env python3
"""
Backfill Quickwit by sending existing S3 JSONL files to the SQS ingestion queue.

Quickwit's SQS source consumes S3 event notification messages. This script
lists existing JSONL files in S3 and sends fake S3 notification messages to
the queue so Quickwit indexes them — same path as auto-ingestion.

Usage:
    python scripts/backfill_quickwit.py \
        --bucket filing-extractions-128638789653 \
        --prefix processed/hkex/ \
        --queue-url https://sqs.ap-east-1.amazonaws.com/128638789653/... \
        --dry-run
"""

import argparse
import json
import logging
import os
import sys

import boto3

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def list_jsonl_files(s3_client, bucket: str, prefix: str) -> list[str]:
    """List all .jsonl files under the given S3 prefix."""
    paginator = s3_client.get_paginator('list_objects_v2')
    keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('.jsonl'):
                keys.append(obj['Key'])
    return keys


def make_s3_notification(bucket: str, key: str) -> str:
    """Build an S3 event notification message body for a single object."""
    return json.dumps({
        "Records": [{
            "s3": {
                "bucket": {"name": bucket},
                "object": {"key": key}
            }
        }]
    })


def send_messages(sqs_client, queue_url: str, bucket: str, keys: list[str]) -> int:
    """Send S3 notification messages to SQS in batches of 10."""
    sent = 0
    batch = []

    for i, key in enumerate(keys):
        batch.append({
            'Id': str(i % 10),
            'MessageBody': make_s3_notification(bucket, key),
        })

        if len(batch) == 10:
            sqs_client.send_message_batch(QueueUrl=queue_url, Entries=batch)
            sent += len(batch)
            batch = []
            if sent % 100 == 0:
                logger.info(f"Sent {sent}/{len(keys)} messages")

    if batch:
        sqs_client.send_message_batch(QueueUrl=queue_url, Entries=batch)
        sent += len(batch)

    return sent


def main():
    parser = argparse.ArgumentParser(
        description="Backfill Quickwit by sending existing S3 JSONL files to SQS"
    )
    parser.add_argument(
        "--bucket",
        required=True,
        help="S3 bucket containing JSONL files"
    )
    parser.add_argument(
        "--prefix",
        default="processed/",
        help="S3 key prefix to scan (default: processed/)"
    )
    parser.add_argument(
        "--queue-url",
        required=True,
        help="SQS queue URL for Quickwit ingestion"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List files without sending SQS messages"
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "ap-east-1"),
        help="AWS region (default: ap-east-1)"
    )

    args = parser.parse_args()

    session = boto3.Session(region_name=args.region)
    s3_client = session.client("s3")
    sqs_client = session.client("sqs")

    logger.info(f"Listing JSONL files in s3://{args.bucket}/{args.prefix}")
    keys = list_jsonl_files(s3_client, args.bucket, args.prefix)
    logger.info(f"Found {len(keys)} JSONL files")

    if not keys:
        logger.info("Nothing to backfill")
        return

    if args.dry_run:
        logger.info("DRY RUN — would send %d SQS messages:", len(keys))
        for key in keys[:10]:
            logger.info(f"  s3://{args.bucket}/{key}")
        if len(keys) > 10:
            logger.info(f"  ... and {len(keys) - 10} more")
        return

    logger.info(f"Sending {len(keys)} messages to {args.queue_url}")
    sent = send_messages(sqs_client, args.queue_url, args.bucket, keys)
    logger.info(f"Done — sent {sent} messages")


if __name__ == "__main__":
    main()
