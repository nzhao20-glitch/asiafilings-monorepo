"""DynamoDB utilities for ETL job tracking and filing dedup."""

import logging
import os
import time
from typing import Dict, List, Optional, Set

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Table names from environment or defaults
JOBS_TABLE = os.environ.get('DYNAMODB_JOBS_TABLE', 'filing-etl-jobs')
ERRORS_TABLE = os.environ.get('DYNAMODB_ERRORS_TABLE', 'filing-etl-errors')
DEDUP_TABLE = os.environ.get('DYNAMODB_DEDUP_TABLE', 'filing-etl-dedup')

# TTL: 90 days in seconds
TTL_SECONDS = 90 * 24 * 60 * 60


def get_dynamo_client():
    """Get DynamoDB client."""
    return boto3.client('dynamodb', region_name=os.environ.get('AWS_REGION', 'ap-east-1'))


def record_job_start(
    job_id: str,
    exchange: str,
    manifest_key: str,
    chunk_start: int,
    chunk_end: int,
    client=None
) -> bool:
    """Record job start in DynamoDB."""
    if not client:
        client = get_dynamo_client()

    try:
        client.put_item(
            TableName=JOBS_TABLE,
            Item={
                'job_id': {'S': job_id},
                'exchange': {'S': exchange or 'unknown'},
                'manifest_key': {'S': manifest_key},
                'chunk_start': {'N': str(chunk_start)},
                'chunk_end': {'N': str(chunk_end)},
                'status': {'S': 'RUNNING'},
                'started_at': {'N': str(int(time.time()))},
                'files_processed': {'N': '0'},
                'files_failed': {'N': '0'},
                'pages_extracted': {'N': '0'},
                'ttl': {'N': str(int(time.time()) + TTL_SECONDS)},
            }
        )
        logger.info(f"Recorded job start: {job_id}")
        return True
    except ClientError as e:
        logger.warning(f"Failed to record job start: {e}")
        return False


def record_job_complete(
    job_id: str,
    stats: Dict,
    status: str = 'SUCCEEDED',
    error_message: Optional[str] = None,
    client=None
) -> bool:
    """Record job completion in DynamoDB."""
    if not client:
        client = get_dynamo_client()

    update_expr = "SET #status = :status, completed_at = :completed_at, " \
                  "files_processed = :fp, files_failed = :ff, " \
                  "pages_extracted = :pe"
    expr_values = {
        ':status': {'S': status},
        ':completed_at': {'N': str(int(time.time()))},
        ':fp': {'N': str(stats.get('files_processed', 0))},
        ':ff': {'N': str(stats.get('files_failed', 0))},
        ':pe': {'N': str(stats.get('pages_extracted', 0))},
    }

    if error_message:
        update_expr += ", error_message = :err"
        expr_values[':err'] = {'S': error_message[:1000]}  # Truncate long errors

    try:
        client.update_item(
            TableName=JOBS_TABLE,
            Key={'job_id': {'S': job_id}},
            UpdateExpression=update_expr,
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues=expr_values
        )
        logger.info(f"Recorded job complete: {job_id} ({status})")
        return True
    except ClientError as e:
        logger.warning(f"Failed to record job complete: {e}")
        return False


def record_file_error(
    job_id: str,
    s3_key: str,
    error_type: str,
    error_message: str,
    client=None
) -> bool:
    """Record file processing error in DynamoDB."""
    if not client:
        client = get_dynamo_client()

    try:
        client.put_item(
            TableName=ERRORS_TABLE,
            Item={
                'job_id': {'S': job_id},
                's3_key': {'S': s3_key},
                'error_type': {'S': error_type},
                'error_message': {'S': error_message[:1000]},
                'timestamp': {'N': str(int(time.time()))},
                'ttl': {'N': str(int(time.time()) + TTL_SECONDS)},
            }
        )
        return True
    except ClientError as e:
        logger.warning(f"Failed to record file error: {e}")
        return False


# --- Dedup functions ---
# pk = "{exchange}#{job_type}", source_id = filing/item ID


def _make_pk(exchange: str, job_type: str) -> str:
    """Build composite partition key."""
    return f"{exchange}#{job_type}"


def batch_check_processed(
    exchange: str,
    source_ids: List[str],
    job_type: str = 'extraction',
    client=None
) -> Set[str]:
    """Check which source_ids are already COMPLETED in the dedup table.

    Uses BatchGetItem (100 items per call) for efficiency.
    Fail-open: on DynamoDB errors, returns empty set (re-processes rather than skips).

    Args:
        exchange: Exchange identifier (e.g. 'HKEX', 'DART')
        source_ids: List of source_ids to check
        job_type: Pipeline step (e.g. 'extraction', 'indexing')
        client: Optional DynamoDB client

    Returns:
        Set of source_ids that are already COMPLETED
    """
    if not source_ids:
        return set()

    if not client:
        client = get_dynamo_client()

    pk = _make_pk(exchange, job_type)
    completed = set()
    batch_size = 100  # BatchGetItem limit

    for i in range(0, len(source_ids), batch_size):
        batch = source_ids[i:i + batch_size]
        keys = [
            {'pk': {'S': pk}, 'source_id': {'S': sid}}
            for sid in batch
        ]

        try:
            response = client.batch_get_item(
                RequestItems={
                    DEDUP_TABLE: {
                        'Keys': keys,
                        'ProjectionExpression': 'source_id, #s',
                        'ExpressionAttributeNames': {'#s': 'status'}
                    }
                }
            )

            for item in response.get('Responses', {}).get(DEDUP_TABLE, []):
                if item.get('status', {}).get('S') == 'COMPLETED':
                    completed.add(item['source_id']['S'])

            # Handle unprocessed keys with retry
            unprocessed = response.get('UnprocessedKeys', {}).get(DEDUP_TABLE)
            if unprocessed:
                logger.warning(f"Dedup: {len(unprocessed.get('Keys', []))} unprocessed keys, retrying")
                time.sleep(0.5)
                retry_response = client.batch_get_item(
                    RequestItems={DEDUP_TABLE: unprocessed}
                )
                for item in retry_response.get('Responses', {}).get(DEDUP_TABLE, []):
                    if item.get('status', {}).get('S') == 'COMPLETED':
                        completed.add(item['source_id']['S'])

        except ClientError as e:
            logger.warning(f"Dedup check failed (fail-open, will re-process): {e}")
            # Fail-open: return what we have so far, don't skip anything we haven't checked

    return completed


def batch_record_processed(
    exchange: str,
    processed_items: List[Dict],
    job_id: str,
    job_type: str = 'extraction',
    client=None
) -> int:
    """Record successfully processed items in the dedup table.

    Uses BatchWriteItem (25 items per call) for efficiency.

    Args:
        exchange: Exchange identifier
        processed_items: List of dicts with keys: source_id, s3_key, pages_extracted
        job_id: Batch job ID
        job_type: Pipeline step (e.g. 'extraction', 'indexing')
        client: Optional DynamoDB client

    Returns:
        Number of items written
    """
    if not processed_items:
        return 0

    if not client:
        client = get_dynamo_client()

    pk = _make_pk(exchange, job_type)
    batch_size = 25  # BatchWriteItem limit
    written = 0
    now = str(int(time.time()))

    for i in range(0, len(processed_items), batch_size):
        batch = processed_items[i:i + batch_size]
        put_requests = []

        for item in batch:
            put_requests.append({
                'PutRequest': {
                    'Item': {
                        'pk': {'S': pk},
                        'source_id': {'S': item['source_id']},
                        'status': {'S': 'COMPLETED'},
                        's3_key': {'S': item['s3_key']},
                        'pages_extracted': {'N': str(item.get('pages_extracted', 0))},
                        'processed_at': {'N': now},
                        'job_id': {'S': job_id},
                    }
                }
            })

        try:
            response = client.batch_write_item(
                RequestItems={DEDUP_TABLE: put_requests}
            )
            unprocessed = response.get('UnprocessedItems', {}).get(DEDUP_TABLE, [])
            written += len(put_requests) - len(unprocessed)

            if unprocessed:
                logger.warning(f"Dedup: {len(unprocessed)} unprocessed writes, retrying")
                time.sleep(0.5)
                retry_response = client.batch_write_item(
                    RequestItems={DEDUP_TABLE: unprocessed}
                )
                retry_unprocessed = retry_response.get('UnprocessedItems', {}).get(DEDUP_TABLE, [])
                written += len(unprocessed) - len(retry_unprocessed)

        except ClientError as e:
            logger.warning(f"Dedup: failed to record batch: {e}")

    logger.info(f"Dedup: recorded {written}/{len(processed_items)} processed items")
    return written


def record_failed(
    exchange: str,
    source_id: str,
    s3_key: str,
    error_message: str,
    job_id: str,
    job_type: str = 'extraction',
    client=None
) -> bool:
    """Record a failed item in the dedup table.

    FAILED items are NOT skipped on re-runs (only COMPLETED are skipped).
    Gets overwritten with COMPLETED on a successful re-run.

    Args:
        exchange: Exchange identifier
        source_id: Item source ID
        s3_key: S3 key of the source file
        error_message: Error description
        job_id: Batch job ID
        job_type: Pipeline step (e.g. 'extraction', 'indexing')
        client: Optional DynamoDB client

    Returns:
        True if recorded successfully
    """
    if not client:
        client = get_dynamo_client()

    try:
        client.put_item(
            TableName=DEDUP_TABLE,
            Item={
                'pk': {'S': _make_pk(exchange, job_type)},
                'source_id': {'S': source_id},
                'status': {'S': 'FAILED'},
                's3_key': {'S': s3_key},
                'error_message': {'S': error_message[:1000]},
                'processed_at': {'N': str(int(time.time()))},
                'job_id': {'S': job_id},
            }
        )
        return True
    except ClientError as e:
        logger.warning(f"Dedup: failed to record failure: {e}")
        return False
