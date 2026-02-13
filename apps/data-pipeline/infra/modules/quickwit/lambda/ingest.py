"""Lambda that ingests JSONL files from S3 into Quickwit.

Triggered by SQS messages containing S3 event notifications.
Downloads the JSONL file, splits into chunks, and POSTs each
chunk to Quickwit's ingest API.

The indexer URL is discovered at runtime via EC2 tag query
and cached for the lifetime of the Lambda container.
"""

import json
import os
import urllib.parse
import urllib.request

import boto3

INDEXER_TAG = os.environ["INDEXER_TAG"]
AWS_REGION_NAME = os.environ.get("AWS_REGION_NAME", os.environ.get("AWS_REGION", "ap-east-1"))
CHUNK_SIZE = int(os.environ.get("CHUNK_SIZE", "1000"))

s3 = boto3.client("s3")
ec2 = boto3.client("ec2", region_name=AWS_REGION_NAME)

# Cached indexer URL — persists across warm Lambda invocations
_cached_quickwit_url = None


def discover_indexer_url():
    """Find the indexer's private IP via EC2 Name tag."""
    resp = ec2.describe_instances(
        Filters=[
            {"Name": "tag:Name", "Values": [INDEXER_TAG]},
            {"Name": "instance-state-name", "Values": ["running"]},
        ]
    )
    for reservation in resp["Reservations"]:
        for instance in reservation["Instances"]:
            ip = instance.get("PublicIpAddress")
            if ip:
                return f"http://{ip}:7280"
    raise RuntimeError(f"No running indexer instance found with tag Name={INDEXER_TAG}")


def get_quickwit_url():
    """Return cached indexer URL, discovering on first call."""
    global _cached_quickwit_url
    if _cached_quickwit_url is None:
        _cached_quickwit_url = discover_indexer_url()
        print(f"Discovered indexer at {_cached_quickwit_url}")
    return _cached_quickwit_url


def clear_cache():
    """Clear cached URL so next call re-discovers."""
    global _cached_quickwit_url
    _cached_quickwit_url = None


def handler(event, context):
    for record in event["Records"]:
        body = json.loads(record["body"])
        for s3_record in body.get("Records", []):
            bucket = s3_record["s3"]["bucket"]["name"]
            key = urllib.parse.unquote_plus(s3_record["s3"]["object"]["key"])

            if not key.endswith(".jsonl"):
                continue

            print(f"Ingesting s3://{bucket}/{key}")
            tmp_path = f"/tmp/{os.path.basename(key)}"
            s3.download_file(bucket, key, tmp_path)

            try:
                chunks_sent = ingest_file(tmp_path)
                print(f"Done: {chunks_sent} chunks sent for {key}")
            finally:
                os.unlink(tmp_path)


def ingest_file(path):
    chunk = []
    chunks_sent = 0

    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            chunk.append(line)
            if len(chunk) >= CHUNK_SIZE:
                post_chunk(chunk)
                chunks_sent += 1
                chunk = []

    if chunk:
        post_chunk(chunk)
        chunks_sent += 1

    return chunks_sent


def post_chunk(lines):
    url = get_quickwit_url()
    data = "\n".join(lines).encode("utf-8")
    req = urllib.request.Request(
        f"{url}/api/v1/filings/ingest?commit=auto",
        data=data,
        headers={"Content-Type": "application/x-ndjson"},
        method="POST",
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        resp.read()
    except urllib.error.URLError:
        # Connection failed — clear cache so next call re-discovers indexer
        clear_cache()
        raise
