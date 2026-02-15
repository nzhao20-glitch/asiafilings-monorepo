# HKEX Scraper & Filing Ingestion Pipeline

Go-based scraper and downloader for Hong Kong Exchange (HKEX) company filings, orchestrated by AWS Step Functions.

## Features

- **Date-range scraping** via HKEX Search API (replaces paginated News API for Lambda)
- **Step Functions workflow** — Scrape → Map(Download) or Batch → Notify
- **Daily automation** — EventBridge triggers at 6 PM HKT; defaults to last 24 hours
- **Historical backfill** — pass `start_date` / `end_date` via the AWS CLI; auto-chunks into monthly iterations to avoid Lambda timeout
- **Concurrent downloads** — Map state fans out one Lambda per filing with configurable concurrency
- **Batch downloads** — AWS Batch (Fargate Spot) for large batches (>1000 filings) and all backfills
- Download to S3 with retry, rate-limit detection, and anti-fingerprinting
- SQLite for local development, PostgreSQL for production

## Project Structure

```
.
├── services/
│   ├── scraper/                          # HKEX scraping service
│   │   ├── scraper.go                    # Core orchestration (Run, RunByDateRange)
│   │   ├── api/
│   │   │   ├── client.go                 # News API client + FetchByDateRange wrapper
│   │   │   └── search.go                 # Search API client (date-range queries)
│   │   └── cmd/
│   │       ├── main.go                   # CLI entry point (SQLite, local dev)
│   │       └── scraper-lambda/           # Lambda handler (PostgreSQL)
│   │           ├── main.go               # Accepts StartDate/EndDate, outputs FilingPayloads
│   │           └── postgres.go           # PostgreSQL connection
│   │
│   ├── downloader/                       # Document download service
│   │   ├── downloader.go                 # Core download logic (retries, rate limiting)
│   │   ├── batch.go                      # Batch download with worker pools
│   │   ├── store.go                      # Database adapter interface
│   │   ├── s3.go                         # S3 upload client
│   │   └── cmd/
│   │       ├── main.go                   # SQS-triggered Lambda (batch of IDs)
│   │       ├── postgres.go               # PostgreSQL queries
│   │       └── sfn-downloader/           # Step Functions Lambda (single filing)
│   │           ├── main.go               # Accepts FilingPayload from Map state
│   │           └── postgres.go           # PostgreSQL update
│   │
│   └── orchestrator/                     # Workflow support Lambdas
│       └── cmd/
│           ├── check-status/             # Poll download status
│           ├── download-trigger/         # Enqueue download jobs to SQS
│           ├── generate-chunks/          # Split date range into monthly chunks (backfill)
│           ├── notify/                   # SNS notifications
│           └── write-manifest/           # Write filing manifest to S3 for Batch
│
├── packages/go/                          # Shared Go libraries
│   ├── config/                           # Environment-based configuration
│   ├── database/                         # SQLite wrapper (local dev)
│   ├── models/                           # Domain models (Company, Filing, etc.)
│   └── storage/                          # Storage interface (local, S3)
│
├── tools/                                # CLI utilities
│   ├── backfill/                         # Historical data backfill
│   ├── job-generator/                    # Generate SQS jobs
│   ├── test-search/                      # Test Search API
│   └── local-downloader/                 # Local download testing
│
├── infra/                                # Terraform IaC
│   ├── environments/prod/                # Root module (provider, SSM, SQS, Lambda)
│   └── modules/
│       ├── batch/                        # AWS Batch compute env, job def, queue
│       ├── lambda/orchestration.tf       # All orchestration + sfn-downloader Lambdas
│       ├── step-functions/main.tf        # State machine (ASL)
│       └── eventbridge/main.tf           # Daily schedule (6 PM HKT)
│
├── Makefile                              # Build targets
└── README.md
```

## Step Functions Workflow

```
EventBridge (daily 6 PM HKT)  ──or──  Manual CLI invocation
            │                                │
            └──────────┬─────────────────────┘
                       ▼
                 ┌────────────┐
                 │ IsBackfill │  Choice: start_date present?
                 └──┬─────┬──┘
              No    │     │  Yes
                    ▼     ▼
              ┌────────┐  ┌────────────────┐
              │ Scrape │  │ GenerateChunks │  Split into monthly ranges
              └───┬────┘  └───────┬────────┘
                  │               ▼
                  │    ┌───────────────────┐
                  │    │  BackfillMonths   │  Map (MaxConcurrency=1)
                  │    │  ┌─────────────┐  │
                  │    │  │ ScrapeMonth  │  │  Per-month scraper Lambda
                  │    │  └──────┬──────┘  │
                  │    │         ▼         │
                  │    │  CheckMonthFilings │
                  │    │    │         │    │
                  │    │    ▼         ▼    │
                  │    │  WriteMon.  Skip  │
                  │    │    │              │
                  │    │    ▼              │
                  │    │  BatchDL   Done   │
                  │    │    │              │
                  │    │    ▼              │
                  │    │  MonthDone        │  ~80B summary per month
                  │    └──────────┬────────┘
                  │               ▼
                  │    ┌────────────────────────┐
                  │    │ NotifyBackfillSuccess  │
                  │    └────────────────────────┘
                  ▼
         ┌─────────────────┐
         │ CheckNewFilings │  Choice: new_filings > 0?
         └───┬─────────┬───┘
          Yes│         │No
             ▼         ▼
       ┌───────────┐ ┌──────────────────┐
       │RouteBySize│ │NotifyNoNewFilings│
       └──┬────┬───┘ └──────────────────┘
     ≤1000│    │>1000
          ▼    ▼
   ┌──────────┐ ┌──────────────┐
   │DownloadF.│ │WriteManifest │
   │(Map x10) │ └──────┬───────┘
   └────┬─────┘        ▼
        │       ┌──────────────┐
        │       │BatchDownload │
        │       └──────┬───────┘
        └──────┬───────┘
               ▼
        ┌──────────────┐
        │NotifySuccess │  SNS summary
        └──────────────┘

   Any error ──────► NotifyFailure
```

### Key Design Decisions

| Aspect | Before | After |
|--------|--------|-------|
| Scraper input | `max_pages` (pagination) | `start_date` / `end_date` (Search API) |
| Daily default | First N pages of News API | Last 24 hours via Search API |
| Download orchestration | SQS queue + polling loop (5 min waits) | Map state with direct Lambda invocation |
| Concurrency control | SQS batch size + reserved concurrency | Map `MaxConcurrency` (default 10) |
| Intermediate Lambdas | download-trigger, check-status, wait loop | Eliminated (Map state handles fan-out) |

## Quick Start

### Local Development

```bash
# Build CLI tools
make build

# Scrape recent announcements (SQLite, metadata only)
go run ./services/scraper/cmd

# Backfill a date range locally
go run ./tools/backfill -from 2024-01-01 -to 2024-01-31

# Download documents locally
go run ./tools/local-downloader -limit 100 -output ./downloads
```

### Build Lambda Packages

```bash
# Build all Lambdas (scraper, downloader, sfn-downloader, orchestrator)
make build-lambdas

# Build individual targets
make build-scraper-lambda
make build-downloader-lambda
make build-sfn-downloader
make build-orchestrator-lambdas
```

### Deploy Infrastructure

```bash
cd infra/environments/prod
terraform init
terraform plan -var="database_url=$DATABASE_URL"
terraform apply -var="database_url=$DATABASE_URL"
```

### Manual Backfill (AWS CLI)

```bash
# Backfill January 2024, Main Board
aws stepfunctions start-execution \
  --state-machine-arn "<STATE_MACHINE_ARN>" \
  --input '{"start_date":"2024-01-01","end_date":"2024-01-31","market":"SEHK"}'

# Backfill GEM market for a specific week
aws stepfunctions start-execution \
  --state-machine-arn "<STATE_MACHINE_ARN>" \
  --input '{"start_date":"2024-06-01","end_date":"2024-06-07","market":"GEM"}'

# Simulate a daily run (last 24 hours)
aws stepfunctions start-execution \
  --state-machine-arn "<STATE_MACHINE_ARN>" \
  --input '{}'
```

## Lambda Functions

| Lambda | Trigger | Input | Output |
|--------|---------|-------|--------|
| **scraper** | Step Functions | `{start_date?, end_date?, market?}` | `{filings: FilingPayload[], new_filings, ...}` |
| **sfn-downloader** | Step Functions Map | `FilingPayload` (single filing) | `{source_id, success, s3_key, error}` |
| **downloader** | SQS | `{filing_ids: [...]}` (batch) | Updates DB directly |
| **write-manifest** | Step Functions | `{filings: FilingPayload[]}` | `{manifest_bucket, manifest_key, array_size}` |
| **generate-chunks** | Step Functions | `{start_date, end_date, market?}` | `{chunks: [{start_date, end_date, market}, ...]}` |
| **check-status** | Step Functions | `{}` | `{pending_downloads, all_downloads_complete}` |
| **download-trigger** | Step Functions | `{filing_ids, batch_size}` | `{batches_sent, filings_queued}` |
| **notify** | Step Functions | `{status, ...stats}` | SNS publish |

> **Note:** `check-status` and `download-trigger` are retained for backward compatibility but are no longer used by the Step Functions workflow. Extraction is now handled by the `data-pipeline` app.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `./hkex.db` | SQLite path (local) or PostgreSQL DSN (Lambda) |
| `HKEX_BASE_URL` | `https://www1.hkexnews.hk` | HKEX API base URL |
| `HKEX_RATE_LIMIT` | `2` | Requests per second |
| `S3_BUCKET` | | S3 bucket for downloaded documents |
| `PROXY_BASE_URL` | | Optional FireProx URL for IP rotation |
| `CONCURRENCY` | `5` | Parallel downloads per Lambda invocation |

### Terraform Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `download_max_concurrency` | `10` | Max parallel download Lambdas in Map state |
| `schedule_expression` | `cron(0 10 * * ? *)` | EventBridge schedule (10 AM UTC = 6 PM HKT) |
| `lambda_timeout` | `300` | Lambda timeout in seconds |
| `max_concurrent_lambdas` | `-1` | Reserved concurrency for SQS downloader |

## API Endpoints Used

1. **Search API** (`/search/titleSearchServlet.do`) — Date-range queries, used by the Lambda scraper and backfill tool. Supports up to 20,000 results per month.
2. **News API** (`/ncms/json/eds/lcisehk1relsdc_{page}.json`) — Paginated recent announcements, used by the local CLI scraper.

## Database Schema (PostgreSQL)

| Table | Key Columns |
|-------|-------------|
| `companies` | `id`, `stock_code` (unique), `company_name`, `market_type`, `exchange` |
| `filings` | `id`, `company_id` (FK), `source_id`, `exchange` (unique: exchange+source_id), `processing_status` |
| `extracted_tables` | `id`, `filing_id` (FK), `page_number`, `headers`, `rows`, `confidence` |

### Processing Statuses

| Status | Meaning |
|--------|---------|
| `PENDING` | Awaiting download |
| `PROCESSING` | Download in progress |
| `COMPLETED` | Successfully downloaded to S3 |
| `FAILED` | Download error (retriable) |
| `URL_FAILURE` | Source URL returned 404 (permanent) |
| `RATE_LIMITED` | HKEX returned 403/429 (retry later) |

## License

MIT
