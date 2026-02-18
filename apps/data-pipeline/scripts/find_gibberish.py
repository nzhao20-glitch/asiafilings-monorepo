#!/usr/bin/env python3
"""
Scan S3 JSONL extraction files to find pages with gibberish text.

Groups results by company_id to identify if broken ToUnicode mappings
are company-specific.

Usage:
    python scripts/find_gibberish.py \
        --bucket filing-extractions-128638789653 \
        --prefix processed/hkex/

    # Limit to a specific company
    python scripts/find_gibberish.py \
        --bucket filing-extractions-128638789653 \
        --prefix processed/hkex/ \
        --company-id 00001
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import unicodedata
from collections import defaultdict
from typing import Optional

import boto3

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Same thresholds as extractor.py
GIBBERISH_REPLACEMENT_RATIO = 0.05
GIBBERISH_UNPRINTABLE_RATIO = 0.10
MIN_TEXT_LENGTH = 20


# Regex to match control chars (Cc), private use (Co), surrogates (Cs)
# U+0000-U+001F (C0 controls, minus tab/newline/cr), U+007F-U+009F (C1 controls),
# U+E000-U+F8FF (Private Use Area), U+D800-U+DFFF (surrogates)
_BAD_CHARS_RE = re.compile(
    r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f'
    r'\uE000-\uF8FF'
    r'\uD800-\uDFFF'
    r'\uFDD0-\uFDEF'  # noncharacters
    r'\uFFFE\uFFFF'
    r']'
)


def is_gibberish(text: str) -> bool:
    """Detect if text is gibberish from broken PDF font encoding."""
    if len(text.strip()) < MIN_TEXT_LENGTH:
        return False

    total = len(text)

    replacement_count = text.count("\ufffd")
    if replacement_count / total > GIBBERISH_REPLACEMENT_RATIO:
        return True

    bad_count = len(_BAD_CHARS_RE.findall(text))
    if bad_count / total > GIBBERISH_UNPRINTABLE_RATIO:
        return True

    return False


def scan_bucket(s3_client, bucket: str, prefix: str, company_filter: str | None):
    """Scan JSONL files and return gibberish stats."""
    paginator = s3_client.get_paginator("list_objects_v2")

    # Stats
    total_files = 0
    total_pages = 0
    gibberish_pages = 0
    # company_id -> list of {document_id, page_number, s3_key}
    by_company: dict[str, list[dict]] = defaultdict(list)

    for list_page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in list_page.get("Contents", []):
            key = obj["Key"]
            if not key.endswith(".jsonl"):
                continue

            total_files += 1
            if total_files % 50 == 0:
                logger.info(
                    f"Scanned {total_files} files, "
                    f"{gibberish_pages}/{total_pages} gibberish pages so far"
                )

            try:
                resp = s3_client.get_object(Bucket=bucket, Key=key)
                stream = resp["Body"]
            except Exception as e:
                logger.warning(f"Failed to read {key}: {e}")
                continue

            # Stream line-by-line to keep memory flat
            for raw_line in stream.iter_lines():
                line = raw_line.decode("utf-8").strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue

                company_id = record.get("company_id", "unknown")
                if company_filter and company_id != company_filter:
                    continue

                text = record.get("text", "")
                total_pages += 1

                if is_gibberish(text):
                    gibberish_pages += 1
                    by_company[company_id].append(
                        {
                            "document_id": record.get("document_id", ""),
                            "page_number": record.get("page_number", 0),
                            "s3_key": record.get("s3_key", ""),
                            "title": record.get("title", ""),
                            "filing_date": record.get("filing_date", ""),
                        }
                    )

    return total_files, total_pages, gibberish_pages, by_company


def main():
    parser = argparse.ArgumentParser(
        description="Find gibberish pages in S3 JSONL extraction files"
    )
    parser.add_argument(
        "--bucket",
        default="filing-extractions-128638789653",
        help="S3 bucket (default: filing-extractions-128638789653)",
    )
    parser.add_argument(
        "--prefix",
        default="processed/",
        help="S3 key prefix (default: processed/)",
    )
    parser.add_argument(
        "--company-id",
        default=None,
        help="Filter to a specific company_id",
    )
    parser.add_argument(
        "--output",
        default=None,
        help="Write full results JSON to this file",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "ap-east-1"),
    )
    args = parser.parse_args()

    session = boto3.Session(region_name=args.region)
    s3_client = session.client("s3")

    logger.info(f"Scanning s3://{args.bucket}/{args.prefix}")
    if args.company_id:
        logger.info(f"Filtering to company_id={args.company_id}")

    total_files, total_pages, gibberish_pages, by_company = scan_bucket(
        s3_client, args.bucket, args.prefix, args.company_id
    )

    # Print summary
    print(f"\n{'='*60}")
    print(f"Scanned {total_files} JSONL files, {total_pages} total pages")
    print(f"Gibberish pages: {gibberish_pages} ({gibberish_pages/max(total_pages,1)*100:.1f}%)")
    print(f"Affected companies: {len(by_company)}")
    print(f"{'='*60}\n")

    # Print per-company breakdown sorted by count descending
    print(f"{'Company ID':<15} {'Gibberish Pages':<18} {'Unique Docs'}")
    print(f"{'-'*15} {'-'*18} {'-'*15}")
    for company_id, pages in sorted(by_company.items(), key=lambda x: -len(x[1])):
        unique_docs = len(set(p["document_id"] for p in pages))
        print(f"{company_id:<15} {len(pages):<18} {unique_docs}")

    # Write full results if requested
    if args.output:
        results = {
            "total_files": total_files,
            "total_pages": total_pages,
            "gibberish_pages": gibberish_pages,
            "by_company": {
                cid: {
                    "count": len(pages),
                    "unique_docs": len(set(p["document_id"] for p in pages)),
                    "pages": pages,
                }
                for cid, pages in sorted(by_company.items(), key=lambda x: -len(x[1]))
            },
        }
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        logger.info(f"Full results written to {args.output}")


if __name__ == "__main__":
    main()
