# HKEX Document Downloader - AWS Lambda Deployment

This directory contains Terraform configuration for deploying a serverless batch downloader to AWS Lambda.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────┐
│  Job Generator  │────▶│   SQS Queue     │────▶│   Lambda     │
│  (Local CLI)    │     │  (Batch jobs)   │     │  Workers     │
│                 │     │                 │     │  (100 files  │
│  - Read from    │     │  - 16K messages │     │   per invoke)│
│    PostgreSQL   │     │  - Batch of 100 │     │              │
│  - Push to SQS  │     │    IDs each     │     │  - Download  │
└─────────────────┘     └─────────────────┘     │  - Save S3   │
                                               │  - Update DB │
                                               └──────┬───────┘
                                                      │
                       ┌─────────────────┐            │
                       │   PostgreSQL    │◀───────────┘
                       │   (RDS)         │
                       └─────────────────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │  S3 Bucket   │
                                               │  (Documents) │
                                               └──────────────┘
```

## Prerequisites

- AWS CLI configured with appropriate credentials
- Terraform >= 1.0
- Go 1.21+
- Existing RDS PostgreSQL instance with the HKEX database migrated

## Quick Start

### 1. Configure Variables

```bash
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your values:
- `s3_bucket_name` - Unique bucket name for documents
- `database_url` - PostgreSQL connection string
- `vpc_id` - VPC where RDS is running
- `subnet_ids` - Subnets with RDS access
- `rds_security_group_id` - Security group of RDS instance

### 2. Deploy Infrastructure

```bash
make init      # Initialize Terraform
make plan      # Preview changes
make deploy    # Build Lambda and deploy everything
```

### 3. Generate Jobs

From the project root:
```bash
./job-generator \
  -database-url "postgres://user:pass@host:5432/hkex" \
  -queue-url "https://sqs.ap-east-1.amazonaws.com/123456789/hkex-downloader-prod-jobs" \
  -batch-size 100
```

### 4. Monitor Progress

```bash
# Check queue status
make queue-status

# Check dead letter queue
make dlq-status

# View Lambda logs
make logs

# Check database progress
psql -h $RDS_HOST -c "SELECT processing_status, COUNT(*) FROM filings GROUP BY processing_status"
```

## CLI Tools

### Local Downloader (for testing)

Test the download logic locally before deploying to Lambda:

```bash
# From project root
./local-downloader -h

# Dry run (no downloads)
./local-downloader -dry-run -limit 10

# Download 100 files locally
./local-downloader -limit 100 -output ./downloads

# Download to S3
./local-downloader -limit 100 -s3-bucket my-bucket

# With FireProx proxy
./local-downloader -limit 100 -proxy "https://xxx.execute-api.ap-east-1.amazonaws.com/fireprox"
```

### Job Generator

Push batches of filing IDs to SQS for Lambda processing:

```bash
./job-generator -h

# Dry run (preview batches)
./job-generator -database-url $DB_URL -dry-run -limit 1000

# Push all pending filings
./job-generator -database-url $DB_URL -queue-url $QUEUE_URL

# Push specific limit with custom batch size
./job-generator -database-url $DB_URL -queue-url $QUEUE_URL -batch-size 50 -limit 10000
```

## Cost Estimate

For downloading 1.6M files (~526GB):

| Component | Calculation | Cost |
|-----------|-------------|------|
| Lambda | 16K invocations × 45s × 512MB | ~$4 |
| SQS | 16K messages | ~$0.01 |
| S3 Storage | 526 GB | ~$12/month |
| S3 PUT requests | 1.6M | ~$8 |
| **Total (one-time)** | | **~$12** |
| **Monthly storage** | | **~$12/month** |

## Makefile Commands

| Command | Description |
|---------|-------------|
| `make build` | Build Lambda binary for ARM64 Linux |
| `make package` | Build and zip Lambda function |
| `make init` | Initialize Terraform |
| `make plan` | Preview Terraform changes |
| `make apply` | Apply Terraform changes |
| `make deploy` | Build, package, and deploy |
| `make update-lambda` | Update Lambda code only (fast) |
| `make queue-status` | Show SQS queue message count |
| `make dlq-status` | Show dead letter queue count |
| `make logs` | Tail Lambda CloudWatch logs |
| `make destroy` | Destroy all AWS resources |
| `make clean` | Remove build artifacts |

## Troubleshooting

### Lambda can't connect to RDS

1. Verify Lambda is in the same VPC as RDS
2. Check security group allows inbound from Lambda SG on port 5432
3. Verify subnet has NAT gateway for outbound internet (S3, HKEX)

### Downloads failing with 403/429

1. Add FireProx proxy URL to reduce rate limiting
2. Reduce `lambda_concurrency` variable
3. Increase `lambda_timeout` for retries

### Messages going to DLQ

1. Check CloudWatch logs for errors
2. Verify database credentials are correct
3. Check S3 bucket permissions

## Optional: FireProx Setup

If HKEX blocks AWS IPs, set up FireProx for IP rotation:

```bash
# Install FireProx
git clone https://github.com/ustayready/fireprox
cd fireprox
pip install -r requirements.txt

# Create API Gateway endpoint
python fire.py --command create --url https://www1.hkexnews.hk --region ap-east-1

# Add the returned URL to terraform.tfvars
proxy_base_url = "https://xxxxx.execute-api.ap-east-1.amazonaws.com/fireprox"
```
