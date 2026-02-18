"""SQS publisher for asynchronous OCR jobs."""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

import boto3

logger = logging.getLogger(__name__)

_sqs_client = None
_missing_queue_warning_logged = False


def _read_bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _read_int_env(name: str, default: int, minimum: int = 1) -> int:
    raw_value = os.environ.get(name, str(default)).strip()
    try:
        parsed = int(raw_value)
        if parsed < minimum:
            raise ValueError(f"{name} must be >= {minimum}")
        return parsed
    except Exception:
        logger.warning("Invalid %s=%r, using default=%s", name, raw_value, default)
        return default


def _get_sqs_client():
    global _sqs_client
    if _sqs_client is None:
        _sqs_client = boto3.client("sqs")
    return _sqs_client


def _chunk_pages(pages: List[int], chunk_size: int) -> Iterable[List[int]]:
    for index in range(0, len(pages), chunk_size):
        yield pages[index:index + chunk_size]


def enqueue_ocr_jobs(
    exchange: str,
    source_id: str,
    s3_bucket: str,
    s3_key: str,
    broken_pages: List[int],
    metadata: Optional[Dict] = None,
) -> int:
    """Publish OCR work items to SQS.

    Returns the number of messages sent.
    """
    global _missing_queue_warning_logged

    if not broken_pages:
        return 0

    enable_ocr_queue = _read_bool_env("ENABLE_OCR_QUEUE", True)
    if not enable_ocr_queue:
        logger.debug("ENABLE_OCR_QUEUE is disabled; skipping OCR queue publish")
        return 0

    queue_url = os.environ.get("OCR_QUEUE_URL", "").strip()
    if not queue_url:
        if not _missing_queue_warning_logged:
            logger.warning("OCR queue publishing is enabled but OCR_QUEUE_URL is unset; skipping")
            _missing_queue_warning_logged = True
        return 0

    if not exchange or not source_id or not s3_bucket or not s3_key:
        logger.warning(
            "Skipping OCR queue publish due to missing metadata: exchange=%r source_id=%r bucket=%r key=%r",
            exchange,
            source_id,
            s3_bucket,
            s3_key,
        )
        return 0

    chunk_size = _read_int_env("OCR_PAGE_CHUNK_SIZE", 10, minimum=1)
    canonical_pages = sorted({int(page) for page in broken_pages if int(page) > 0})
    submitted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    metadata_payload = {}
    allowed_metadata_keys = ("company_id", "company_name", "filing_date", "filing_type", "title")
    if metadata:
        for key in allowed_metadata_keys:
            value = metadata.get(key)
            if value:
                metadata_payload[key] = value

    sent_count = 0
    sqs_client = _get_sqs_client()
    for pages_chunk in _chunk_pages(canonical_pages, chunk_size):
        body = {
            "version": 1,
            "exchange": exchange.upper(),
            "source_id": source_id,
            "s3_bucket": s3_bucket,
            "s3_key": s3_key,
            "broken_pages": pages_chunk,
            "submitted_at": submitted_at,
            "metadata": metadata_payload,
        }
        sqs_client.send_message(
            QueueUrl=queue_url,
            MessageBody=json.dumps(body, separators=(",", ":")),
        )
        sent_count += 1

    logger.info(
        "Queued %s OCR message(s) for %s:%s (%s pages)",
        sent_count,
        exchange.upper(),
        source_id,
        len(canonical_pages),
    )
    return sent_count
