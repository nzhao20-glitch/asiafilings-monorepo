"""SQS-driven OCR worker for broken PDF pages."""

import hashlib
import json
import logging
import os
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.error import URLError
from urllib.request import urlopen

import boto3
import pymupdf
from botocore.exceptions import ClientError

from extractor import _extract_with_onnxtr, warm_onnxtr_predictor
from s3_utils import upload_json, upload_jsonl

logging.basicConfig(
    level=getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@dataclass
class OcrJob:
    exchange: str
    source_id: str
    s3_bucket: str
    s3_key: str
    broken_pages: List[int]
    metadata: Dict[str, str]


@dataclass
class EcsTaskIdentity:
    cluster: str
    task_arn: str


def _read_int_env(name: str, default: int, minimum: int = 1, maximum: int = 2**31 - 1) -> int:
    raw_value = os.environ.get(name, str(default)).strip()
    try:
        parsed = int(raw_value)
        if parsed < minimum or parsed > maximum:
            raise ValueError(f"{name} outside bounds")
        return parsed
    except Exception:
        logger.warning("Invalid %s=%r, using default=%s", name, raw_value, default)
        return default


def _read_bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _discover_ecs_task_identity() -> Optional[EcsTaskIdentity]:
    metadata_uri = os.environ.get("ECS_CONTAINER_METADATA_URI_V4", "").strip()
    if not metadata_uri:
        return None

    try:
        with urlopen(f"{metadata_uri}/task", timeout=2) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (OSError, URLError, ValueError) as exc:
        logger.warning("Could not read ECS task metadata for scale-in protection: %s", exc)
        return None

    cluster = str(payload.get("Cluster", "")).strip()
    task_arn = str(payload.get("TaskARN", "")).strip()
    if not cluster or not task_arn:
        logger.warning("ECS metadata is missing Cluster or TaskARN; disabling scale-in protection")
        return None

    return EcsTaskIdentity(cluster=cluster, task_arn=task_arn)


def _set_task_protection(ecs_client, identity: EcsTaskIdentity, enabled: bool, expires_minutes: int) -> bool:
    params = {
        "cluster": identity.cluster,
        "tasks": [identity.task_arn],
        "protectionEnabled": enabled,
    }
    if enabled:
        params["expiresInMinutes"] = expires_minutes

    try:
        result = ecs_client.update_task_protection(**params)
        failures = result.get("failures") or []
        if failures:
            logger.warning("ECS task protection update failures: %s", failures)
            return False
        return True
    except ClientError as exc:
        logger.warning("Failed to update ECS task scale-in protection (enabled=%s): %s", enabled, exc)
        return False


def _parse_job(message_body: str) -> OcrJob:
    payload = json.loads(message_body)
    required = ("exchange", "source_id", "s3_bucket", "s3_key", "broken_pages")
    missing = [field for field in required if field not in payload]
    if missing:
        raise ValueError(f"Missing required fields: {missing}")

    raw_pages = payload["broken_pages"]
    if not isinstance(raw_pages, list) or not raw_pages:
        raise ValueError("broken_pages must be a non-empty list")

    parsed_pages = sorted({int(page) for page in raw_pages if int(page) > 0})
    if not parsed_pages:
        raise ValueError("No valid page numbers in broken_pages")

    exchange = str(payload["exchange"]).strip().upper()
    source_id = str(payload["source_id"]).strip()
    s3_bucket = str(payload["s3_bucket"]).strip()
    s3_key = str(payload["s3_key"]).strip()

    if not exchange or not source_id or not s3_bucket or not s3_key:
        raise ValueError("exchange, source_id, s3_bucket, and s3_key must be non-empty")

    metadata_payload = payload.get("metadata") or {}
    if not isinstance(metadata_payload, dict):
        raise ValueError("metadata must be an object when present")
    metadata = {}
    for key in ("company_id", "company_name", "filing_date", "filing_type", "title"):
        value = metadata_payload.get(key)
        if value:
            metadata[key] = str(value)

    return OcrJob(
        exchange=exchange,
        source_id=source_id,
        s3_bucket=s3_bucket,
        s3_key=s3_key,
        broken_pages=parsed_pages,
        metadata=metadata,
    )


def _object_exists(s3_client, bucket: str, key: str) -> bool:
    try:
        s3_client.head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def _build_quickwit_patch_key(job: OcrJob, output_prefix: str) -> str:
    pages_joined = ",".join(str(page) for page in job.broken_pages)
    pages_digest = hashlib.sha1(pages_joined.encode("utf-8")).hexdigest()[:12]
    return (
        f"{output_prefix}/{job.exchange.lower()}/ocr-patches/{job.source_id}/"
        f"pages_{job.broken_pages[0]}_{job.broken_pages[-1]}_{pages_digest}.jsonl"
    )


def _build_quickwit_record(job: OcrJob, page_number: int, total_pages: int, text: str) -> Dict:
    record = {
        "unique_page_id": f"{job.exchange}_{job.source_id}_pg{page_number}",
        "document_id": job.source_id,
        "page_number": page_number,
        "total_pages": total_pages,
        "text": text,
        "ocr_required": True,
        "s3_key": job.s3_key,
        "file_type": "pdf",
        "exchange": job.exchange,
    }
    for key, value in job.metadata.items():
        record[key] = value
    return record


def _process_job(job: OcrJob, s3_client, output_bucket: str, output_prefix: str) -> Tuple[int, str]:
    logger.info(
        "Processing OCR job %s:%s pages=%s",
        job.exchange,
        job.source_id,
        job.broken_pages,
    )

    response = s3_client.get_object(Bucket=job.s3_bucket, Key=job.s3_key)
    pdf_bytes = response["Body"].read()
    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")

    try:
        page_count = len(document)
        processed = 0
        quickwit_records = []

        for page_number in job.broken_pages:
            if page_number < 1 or page_number > page_count:
                logger.warning(
                    "Skipping out-of-range page %s for %s:%s (page_count=%s)",
                    page_number,
                    job.exchange,
                    job.source_id,
                    page_count,
                )
                continue

            page = document[page_number - 1]
            extraction = _extract_with_onnxtr(page)
            ocr_text = extraction.get("text", "")
            bboxes = extraction.get("ocr_bboxes", [])
            output_key = f"ocr-bboxes/{job.exchange.lower()}/{job.source_id}/page_{page_number}.json"
            if not upload_json(output_bucket, output_key, bboxes, client=s3_client):
                raise RuntimeError(f"Failed to upload OCR output for page {page_number}")
            quickwit_records.append(
                _build_quickwit_record(
                    job=job,
                    page_number=page_number,
                    total_pages=page_count,
                    text=ocr_text,
                )
            )
            processed += 1

        patch_key = _build_quickwit_patch_key(job, output_prefix)
        if quickwit_records:
            if _object_exists(s3_client, output_bucket, patch_key):
                logger.info("Quickwit OCR patch already exists, skipping upload: s3://%s/%s", output_bucket, patch_key)
            elif not upload_jsonl(output_bucket, patch_key, quickwit_records, client=s3_client):
                raise RuntimeError("Failed to upload OCR Quickwit patch JSONL")

        return processed, patch_key
    finally:
        document.close()


def main() -> None:
    queue_url = os.environ.get("OCR_QUEUE_URL", "").strip()
    if not queue_url:
        raise RuntimeError("OCR_QUEUE_URL is required")

    output_bucket = os.environ.get(
        "OCR_OUTPUT_BUCKET",
        os.environ.get("OUTPUT_BUCKET", "filing-extractions-128638789653"),
    ).strip()
    if not output_bucket:
        raise RuntimeError("OCR_OUTPUT_BUCKET or OUTPUT_BUCKET is required")
    output_prefix = os.environ.get("OUTPUT_PREFIX", "processed").strip() or "processed"

    wait_seconds = _read_int_env("OCR_QUEUE_WAIT_SECONDS", 20, minimum=0, maximum=20)
    visibility_timeout = _read_int_env("OCR_QUEUE_VISIBILITY_TIMEOUT", 900, minimum=0, maximum=43200)
    max_messages = _read_int_env("OCR_QUEUE_MAX_MESSAGES", 1, minimum=1, maximum=10)
    run_once = _read_bool_env("OCR_WORKER_RUN_ONCE", False)
    warm_model_on_startup = _read_bool_env("WARM_ONNXTR_ON_STARTUP", True)
    scale_in_protection_enabled = _read_bool_env("ECS_SCALE_IN_PROTECTION_ENABLED", True)
    task_protection_minutes = _read_int_env("ECS_TASK_PROTECTION_MINUTES", 30, minimum=1, maximum=2880)

    sqs_client = boto3.client("sqs")
    s3_client = boto3.client("s3")
    ecs_client = boto3.client("ecs") if scale_in_protection_enabled else None
    ecs_identity = _discover_ecs_task_identity() if scale_in_protection_enabled else None
    if scale_in_protection_enabled and not ecs_identity:
        scale_in_protection_enabled = False

    logger.info(
        "Starting OCR worker (queue=%s, output_bucket=%s, output_prefix=%s, max_messages=%s, run_once=%s, warm_model=%s, scale_in_protection=%s, protection_minutes=%s)",
        queue_url,
        output_bucket,
        output_prefix,
        max_messages,
        run_once,
        warm_model_on_startup,
        scale_in_protection_enabled,
        task_protection_minutes,
    )

    if warm_model_on_startup:
        if warm_onnxtr_predictor():
            logger.info("OnnxTR predictor warmed successfully")
        else:
            logger.warning("OnnxTR predictor warmup failed; worker will continue and retry lazily")

    while True:
        response = sqs_client.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=max_messages,
            WaitTimeSeconds=wait_seconds,
            VisibilityTimeout=visibility_timeout,
        )
        messages = response.get("Messages", [])
        if not messages:
            if run_once:
                logger.info("No messages received; exiting run-once worker")
                return
            continue

        for message in messages:
            message_id = message.get("MessageId", "<unknown>")
            body = message.get("Body", "")
            receipt_handle = message.get("ReceiptHandle")
            if not receipt_handle:
                logger.warning("Received message without receipt handle: %s", message_id)
                continue

            task_protected = False
            try:
                if scale_in_protection_enabled and ecs_client and ecs_identity:
                    task_protected = _set_task_protection(
                        ecs_client=ecs_client,
                        identity=ecs_identity,
                        enabled=True,
                        expires_minutes=task_protection_minutes,
                    )
                    if not task_protected:
                        scale_in_protection_enabled = False
                        logger.warning("Disabling task scale-in protection after failed enable call")

                job = _parse_job(body)
                pages_processed, patch_key = _process_job(
                    job,
                    s3_client=s3_client,
                    output_bucket=output_bucket,
                    output_prefix=output_prefix,
                )
                sqs_client.delete_message(QueueUrl=queue_url, ReceiptHandle=receipt_handle)
                logger.info(
                    "Completed OCR job %s (%s pages, patch=s3://%s/%s)",
                    message_id,
                    pages_processed,
                    output_bucket,
                    patch_key,
                )
            except Exception as exc:
                logger.exception(
                    "OCR job failed for message %s; leaving in queue for retry/DLQ: %s",
                    message_id,
                    exc,
                )
            finally:
                if task_protected and ecs_client and ecs_identity:
                    if not _set_task_protection(
                        ecs_client=ecs_client,
                        identity=ecs_identity,
                        enabled=False,
                        expires_minutes=task_protection_minutes,
                    ):
                        scale_in_protection_enabled = False
                        logger.warning("Disabling task scale-in protection after failed disable call")

        if run_once:
            logger.info("Run-once mode complete")
            return


if __name__ == "__main__":
    main()
