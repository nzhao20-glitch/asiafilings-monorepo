# Filing ETL Pipeline

Extract text from document filings (DART, HKEX, SEC) at scale using AWS Batch, with full-text search via Quickwit.

## Supported File Types

| Type | Extension | Text |
|------|-----------|------|
| PDF | `.pdf` | ✅ |
| HTML | `.htm`, `.html` | ✅ |
| Word | `.doc`, `.docx` | ❌ |

**Note:** Source buckets contain mixed file types. Unsupported formats are skipped with a warning. HTML files are treated as single-page documents.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  pdfs-128638789653/                                                 │
│  ├── dart/{corp}/{date}/{id}.pdf    ──┐                            │
│  ├── hkex/{company}/{date}/{id}.pdf ──┼──► AWS Batch (ETL Worker)  │
│  └── hkex/{company}/{date}/{id}.htm ──┘    PyMuPDF / BeautifulSoup │
│                                       │                             │
│  PostgreSQL (manifest metadata) ──────┘                             │
│                                                                     │
│                            │                                        │
│                            ▼                                        │
│  filing-extractions-128638789653/                                   │
│  └── processed/{exchange}/batch_000001.jsonl ──► SQS ──► Quickwit  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
filing-etl-pipeline/
├── etl_worker/           # Python extraction worker
│   ├── src/
│   │   ├── extractor.py  # PyMuPDF/BS4 text extraction
│   │   ├── s3_utils.py   # S3 download/upload helpers
│   │   └── main.py       # Batch job entry point
│   ├── Dockerfile
│   └── requirements.txt
├── infrastructure/       # Terraform (Batch, S3, Quickwit EC2)
├── search_config/        # Quickwit index schema
└── scripts/              # Manifest generation & job triggers
```

## Quick Start

### 1. Deploy Infrastructure

```bash
cd infrastructure
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform init && terraform apply
```

### 2. Build & Push Docker Image

```bash
# Create ECR repo (one-time)
aws ecr create-repository --repository-name filing-etl --region ap-east-1

# Build and push
make push
```

### 3. Generate Manifest

```bash
# Option A: From database (includes metadata)
DATABASE_URL="postgresql://..." python scripts/generate_manifest.py \
  --database --exchange HKEX --output manifest.csv

# Option B: From S3 (basic)
python scripts/generate_manifest.py \
  --bucket pdfs-128638789653 --prefix hkex/ --output manifest.csv

# Upload manifest
aws s3 cp manifest.csv s3://filing-extractions-128638789653/manifests/hkex.csv
```

### 4. Run Batch Job

```bash
python scripts/trigger_batch.py \
  --manifest-bucket filing-extractions-128638789653 \
  --manifest-key manifests/hkex.csv \
  --exchange HKEX \
  --chunk-size 1000
```

## Integration Test

```bash
# Generate small test manifest (10 files)
python scripts/generate_manifest.py --bucket pdfs-128638789653 --prefix hkex/ --output test.csv
head -11 test.csv > small_test.csv
aws s3 cp small_test.csv s3://filing-extractions-128638789653/manifests/test.csv

# Trigger test job
python scripts/trigger_batch.py \
  --manifest-bucket filing-extractions-128638789653 \
  --manifest-key manifests/test.csv \
  --exchange HKEX \
  --chunk-size 10

# Verify outputs
aws s3 ls s3://filing-extractions-128638789653/processed/
aws s3 cp s3://filing-extractions-128638789653/processed/batch_000000.jsonl - | head -1 | jq
```

## Production Batch

For ~900K HKEX PDFs:

```bash
# Generate full manifest
DATABASE_URL="..." python scripts/generate_manifest.py \
  --database --exchange HKEX --output hkex_full.csv
aws s3 cp hkex_full.csv s3://filing-extractions-128638789653/manifests/hkex_full.csv

# Trigger batch (creates ~900 array jobs)
python scripts/trigger_batch.py \
  --manifest-bucket filing-extractions-128638789653 \
  --manifest-key manifests/hkex_full.csv \
  --exchange HKEX

# Monitor
aws batch list-jobs --job-queue filing-etl-prod-queue --job-status RUNNING
aws batch list-jobs --job-queue filing-etl-prod-queue --job-status FAILED
```

**Estimated time:** ~1.5 hours with 50 concurrent Fargate Spot jobs.

## Output Formats

### JSONL (Quickwit)

```json
{
  "unique_page_id": "HKEX_12345_pg1",
  "document_id": "12345",
  "exchange": "HKEX",
  "company_id": "00001",
  "company_name": "Example Corp",
  "filing_date": "2024-12-01",
  "page_number": 1,
  "total_pages": 45,
  "text": "Full page text...",
  "s3_key": "hkex/00001/2024/12/01/12345.pdf"
}
```

## Query Quickwit

```bash
# Full-text search
curl "http://quickwit:7280/api/v1/filings/search" \
  -d '{"query": "revenue growth", "max_hits": 10}'

# Get specific page
curl "http://quickwit:7280/api/v1/filings/search" \
  -d '{"query": "unique_page_id:HKEX_12345_pg2"}'

# Filter by company
curl "http://quickwit:7280/api/v1/filings/search" \
  -d '{"query": "company_id:00001 AND revenue"}'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MANIFEST_BUCKET` | S3 bucket with manifest CSV | required |
| `MANIFEST_KEY` | S3 key of manifest CSV | required |
| `OUTPUT_BUCKET` | S3 bucket for outputs | required |
| `OUTPUT_PREFIX` | Prefix for JSONL files | `processed` |
| `EXCHANGE` | Exchange identifier | optional |
| `CHUNK_SIZE` | Files per batch job | `1000` |

## Infrastructure

- **AWS Batch**: Fargate Spot compute (cost-effective)
- **S3**: Source PDFs + extraction outputs
- **SQS**: Notifications for Quickwit ingestion
- **Quickwit**: Full-text search on EC2 (t3.medium)

