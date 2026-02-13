# HKEX Scraper

A Go-based scraper and downloader for Hong Kong Exchange (HKEX) company filings and announcements.

## Features

- Scrape announcements from HKEX News API (recent data)
- Backfill historical data using HKEX Search API (2000-present)
- Download documents (PDF, HTM, etc.) locally or to S3
- AWS Lambda deployment for parallel batch downloading
- SQLite for local development, PostgreSQL for production

## Project Structure

```
.
├── cmd/                       # CLI tools
│   ├── scraper/               # Real-time scraper using News API
│   ├── backfill/              # Historical backfill using Search API
│   ├── local-downloader/      # Local document downloader (for testing)
│   └── job-generator/         # Generate SQS jobs for Lambda
├── lambda/                    # AWS Lambda functions
│   ├── downloader/            # Go - Document downloader
│   ├── extractor/             # Python - PDF text extraction
│   └── meilisearch-indexer/   # Python - Meilisearch indexing
├── internal/
│   ├── api/                   # HKEX API clients
│   ├── database/              # SQLite database layer
│   ├── downloader/            # Shared download logic
│   ├── models/                # Data models
│   └── config/                # Configuration
├── deployments/
│   └── terraform/             # AWS infrastructure (Lambda, S3, SQS)
├── migrations/                # SQL migrations
└── downloads/                 # Local download directory
```

## Quick Start

### 1. Build

```bash
go build -o hkex-scraper ./cmd/scraper
go build -o hkex-backfill ./cmd/backfill
go build -o local-downloader ./cmd/local-downloader
```

### 2. Scrape Recent Announcements

```bash
# Fetch latest announcements
./hkex-scraper

# Limit pages
HKEX_MAX_PAGES=5 ./hkex-scraper
```

### 3. Backfill Historical Data

```bash
# Backfill a date range
./hkex-backfill -from 2020-01-01 -to 2020-12-31

# Dry run (preview only)
./hkex-backfill -from 2020-01-01 -to 2020-12-31 -dry-run

# Specific market
./hkex-backfill -from 2020-01-01 -to 2020-12-31 -market GEM
```

### 4. Download Documents

```bash
# Download locally
./local-downloader -limit 100 -output ./downloads

# Dry run
./local-downloader -dry-run -limit 10
```

## Database

The scraper uses SQLite by default (`./hkex.db`). Tables:

- `companies` - Listed companies with stock codes
- `filings` - Announcements/filings with download URLs
- `extracted_tables` - Tables extracted from PDFs (future)

### Check Status

```bash
# Total filings
sqlite3 hkex.db "SELECT COUNT(*) FROM filings"

# By processing status
sqlite3 hkex.db "SELECT processing_status, COUNT(*) FROM filings GROUP BY processing_status"

# By filing type
sqlite3 hkex.db "SELECT filing_type, COUNT(*) FROM filings GROUP BY filing_type ORDER BY 2 DESC"
```

## AWS Lambda Deployment

For downloading millions of documents at scale, deploy to AWS Lambda:

```bash
cd deployments/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your AWS settings

make init
make deploy
```

See [deployments/terraform/README.md](deployments/terraform/README.md) for detailed instructions.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HKEX_DATABASE_URL` | `./hkex.db` | SQLite database path |
| `HKEX_BASE_URL` | `https://www1.hkexnews.hk` | HKEX API base URL |
| `HKEX_RATE_LIMIT` | `5` | Requests per second |
| `HKEX_MAX_PAGES` | `0` (unlimited) | Max pages to scrape |

## API Endpoints Used

1. **News API** (`/ncms/json.htm`) - Recent announcements, paginated
2. **Search API** (`/search/titleSearchServlet.do`) - Historical search by date range

## Data Statistics (as of Nov 2024)

- ~1.6M filings from 2000-2024
- ~81% PDF, ~9% HTM, ~10% other formats
- Total size: ~526GB

## License

MIT
