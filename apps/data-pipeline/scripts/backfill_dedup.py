#!/usr/bin/env python3
"""
Backfill the DynamoDB dedup table from manifest CSVs.

Marks all source_ids in a manifest as COMPLETED so they won't be
re-processed on future ETL runs.

Usage:
    # From local manifest file
    python scripts/backfill_dedup.py --manifest manifest_hkex_00694.csv --exchange HKEX

    # From S3 manifest
    python scripts/backfill_dedup.py \
        --manifest-bucket filing-extractions-128638789653 \
        --manifest-key manifests/hkex_00694.csv \
        --exchange HKEX

    # Custom job type (default: extraction)
    python scripts/backfill_dedup.py --manifest manifest.csv --exchange HKEX --job-type indexing

    # Dry run
    python scripts/backfill_dedup.py --manifest manifest.csv --exchange HKEX --dry-run
"""

import argparse
import csv
import io
import logging
import os
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

REGION = os.environ.get('AWS_REGION', 'ap-east-1')
DEDUP_TABLE = os.environ.get('DYNAMODB_DEDUP_TABLE', 'filing-etl-prod-dedup')


def read_manifest_local(path: str) -> list[dict]:
    """Read source_ids from a local manifest CSV."""
    items = []
    with open(path, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = row['key']
            source_id = Path(key).stem.rstrip('.')
            items.append({'source_id': source_id, 's3_key': key})
    return items


def read_manifest_s3(bucket: str, key: str) -> list[dict]:
    """Read source_ids from an S3 manifest CSV."""
    s3 = boto3.client('s3', region_name=REGION)
    response = s3.get_object(Bucket=bucket, Key=key)
    content = response['Body'].read().decode('utf-8')
    reader = csv.DictReader(io.StringIO(content))
    items = []
    for row in reader:
        s3_key = row['key']
        source_id = Path(s3_key).stem.rstrip('.')
        items.append({'source_id': source_id, 's3_key': s3_key})
    return items


def backfill(items: list[dict], exchange: str, job_type: str, dry_run: bool = False):
    """Write COMPLETED records to the dedup table."""
    pk = f"{exchange}#{job_type}"
    logger.info(f"Backfilling {len(items)} items with pk={pk}")

    if dry_run:
        logger.info("Dry run — no writes will be made")
        for item in items[:5]:
            logger.info(f"  Would write: pk={pk} source_id={item['source_id']} s3_key={item['s3_key']}")
        if len(items) > 5:
            logger.info(f"  ... and {len(items) - 5} more")
        return

    client = boto3.client('dynamodb', region_name=REGION)
    batch_size = 25
    written = 0
    now = str(int(time.time()))

    for i in range(0, len(items), batch_size):
        batch = items[i:i + batch_size]
        put_requests = [
            {
                'PutRequest': {
                    'Item': {
                        'pk': {'S': pk},
                        'source_id': {'S': item['source_id']},
                        'status': {'S': 'COMPLETED'},
                        's3_key': {'S': item['s3_key']},
                        'pages_extracted': {'N': '0'},
                        'processed_at': {'N': now},
                        'job_id': {'S': 'backfill'},
                    }
                }
            }
            for item in batch
        ]

        try:
            response = client.batch_write_item(
                RequestItems={DEDUP_TABLE: put_requests}
            )
            unprocessed = response.get('UnprocessedItems', {}).get(DEDUP_TABLE, [])
            written += len(put_requests) - len(unprocessed)

            if unprocessed:
                time.sleep(0.5)
                retry = client.batch_write_item(
                    RequestItems={DEDUP_TABLE: unprocessed}
                )
                retry_unprocessed = retry.get('UnprocessedItems', {}).get(DEDUP_TABLE, [])
                written += len(unprocessed) - len(retry_unprocessed)

        except ClientError as e:
            logger.error(f"Failed to write batch at offset {i}: {e}")

        if (i + batch_size) % 500 == 0:
            logger.info(f"Progress: {min(i + batch_size, len(items))}/{len(items)}")

    logger.info(f"Done: wrote {written}/{len(items)} records to {DEDUP_TABLE}")


def main():
    global DEDUP_TABLE
    parser = argparse.ArgumentParser(description='Backfill dedup table from manifest')
    parser.add_argument('--manifest', help='Local manifest CSV path')
    parser.add_argument('--manifest-bucket', help='S3 bucket for manifest')
    parser.add_argument('--manifest-key', help='S3 key for manifest')
    parser.add_argument('--exchange', required=True, help='Exchange identifier (e.g. HKEX, DART)')
    parser.add_argument('--job-type', default='extraction', help='Pipeline step (default: extraction)')
    parser.add_argument('--table', default=DEDUP_TABLE, help=f'DynamoDB table name (default: {DEDUP_TABLE})')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be written without writing')
    args = parser.parse_args()

    DEDUP_TABLE = args.table

    if args.manifest:
        items = read_manifest_local(args.manifest)
    elif args.manifest_bucket and args.manifest_key:
        items = read_manifest_s3(args.manifest_bucket, args.manifest_key)
    else:
        parser.error('Provide either --manifest or --manifest-bucket + --manifest-key')
        return

    logger.info(f"Read {len(items)} items from manifest")
    backfill(items, args.exchange, args.job_type, dry_run=args.dry_run)


if __name__ == '__main__':
    main()
