#!/usr/bin/env python3
"""
Generate a manifest CSV of filings from PostgreSQL for ETL processing.

Queries the filings table with metadata (company name, filing type, etc.)
to produce a rich manifest for the ETL worker.

Usage:
    python generate_manifest.py --exchange HKEX --output manifest.csv
    python generate_manifest.py --exchange HKEX --limit 3000 --output test.csv

Requires DATABASE_URL environment variable.

The manifest CSV contains columns:
    bucket, key, source_id, exchange, company_id, company_name,
    filing_date, filing_type, title
"""

import argparse
import csv
import logging
import os
import sys
from typing import Dict, Generator

import boto3

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def query_filings_from_db(
    database_url: str,
    exchange: str = None,
    company_id: str = None,
    status: str = "COMPLETED",
    limit: int = None
) -> Generator[Dict, None, None]:
    """Query filings from PostgreSQL database.

    Yields:
        Dictionaries with filing metadata
    """
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        logger.error("psycopg2 not installed. Run: pip install psycopg2-binary")
        sys.exit(1)

    conn = psycopg2.connect(database_url)
    cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    query = """
        SELECT
            f.exchange,
            f.source_id,
            f.company_id,
            c.name as company_name,
            f.title,
            f.report_date as filing_date,
            f.filing_type,
            f.pdf_s3_key as s3_key
        FROM filings f
        LEFT JOIN companies c ON f.exchange = c.exchange AND f.company_id = c.company_id
        WHERE f.pdf_s3_key IS NOT NULL
          AND f.pdf_s3_key != ''
    """

    params = []
    if exchange:
        query += " AND f.exchange = %s"
        params.append(exchange.upper())
    if company_id:
        query += " AND f.company_id = %s"
        params.append(company_id)
    if status:
        query += " AND f.processing_status = %s"
        params.append(status)

    query += " ORDER BY f.report_date DESC"

    if limit:
        query += f" LIMIT {int(limit)}"

    logger.info(f"Executing query with exchange={exchange}, status={status}")
    cursor.execute(query, params)

    for row in cursor:
        yield dict(row)

    cursor.close()
    conn.close()


def get_bucket_from_exchange(exchange: str, s3_key: str) -> str:
    """Determine S3 bucket based on exchange.

    All PDFs are stored in a single bucket with exchange prefixes:
    pdfs-128638789653/dart/... and pdfs-128638789653/hkex/...
    """
    return os.environ.get('PDF_BUCKET', 'pdfs-128638789653')


def write_manifest(output_path: str, items: Generator) -> int:
    """Write manifest CSV file.

    Args:
        output_path: Output file path
        items: Generator of filing dicts from database query

    Returns:
        Number of items written
    """
    headers = [
        "bucket", "key", "source_id", "exchange",
        "company_id", "company_name", "filing_date", "filing_type", "title"
    ]

    count = 0

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers, extrasaction='ignore')
        writer.writeheader()

        for item in items:
            row = dict(item)
            bucket = get_bucket_from_exchange(
                row.get('exchange', ''),
                row.get('s3_key', '')
            )
            row['bucket'] = bucket
            row['key'] = row.pop('s3_key', '')
            if row.get('filing_date'):
                row['filing_date'] = str(row['filing_date'])
            writer.writerow(row)

            count += 1
            if count % 10000 == 0:
                logger.info(f"Progress: {count} files listed")

    return count


def upload_manifest(s3_client, local_path: str, bucket: str, key: str):
    """Upload manifest to S3."""
    s3_client.upload_file(local_path, bucket, key)
    logger.info(f"Uploaded manifest to s3://{bucket}/{key}")


def main():
    parser = argparse.ArgumentParser(
        description="Generate manifest CSV of filings from database for ETL processing"
    )

    parser.add_argument(
        "--exchange",
        help="Filter by exchange (e.g., DART, HKEX)"
    )
    parser.add_argument(
        "--company-id",
        help="Filter by company ID (e.g., 00001)"
    )
    parser.add_argument(
        "--status",
        default="COMPLETED",
        help="Filter by processing status (default: COMPLETED)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Limit number of records"
    )
    parser.add_argument(
        "--output",
        default="manifest.csv",
        help="Output manifest file path"
    )
    parser.add_argument(
        "--upload-bucket",
        help="S3 bucket to upload manifest to"
    )
    parser.add_argument(
        "--upload-key",
        help="S3 key for uploaded manifest"
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "ap-east-1"),
        help="AWS region"
    )

    args = parser.parse_args()

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL environment variable is required")
        sys.exit(1)

    s3_client = boto3.client("s3", region_name=args.region)

    logger.info(f"Querying database for filings (exchange={args.exchange})...")
    items = query_filings_from_db(
        database_url,
        exchange=args.exchange,
        company_id=args.company_id,
        status=args.status,
        limit=args.limit,
    )
    count = write_manifest(args.output, items)

    logger.info(f"Manifest written to {args.output}")
    logger.info(f"Total files: {count}")

    if count == 0:
        logger.warning("No files found!")
        sys.exit(0)

    if args.upload_bucket and args.upload_key:
        upload_manifest(s3_client, args.output, args.upload_bucket, args.upload_key)
        print(f"\nTo trigger batch job, run:")
        print(f"  python trigger_batch.py --manifest-bucket {args.upload_bucket} --manifest-key {args.upload_key}")
    else:
        print(f"\nTo upload manifest to S3:")
        print(f"  aws s3 cp {args.output} s3://<bucket>/<key>")


if __name__ == "__main__":
    main()
