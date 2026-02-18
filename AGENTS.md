<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- You have access to the Nx MCP server and its tools, use them to help the user
- When answering questions about the repository, use the `nx_workspace` tool first to gain an understanding of the workspace architecture where applicable.
- When working in individual projects, use the `nx_project_details` mcp tool to analyze and understand the specific project structure and dependencies
- For questions around nx configuration, best practices or if you're unsure, use the `nx_docs` tool to get relevant, up-to-date docs. Always use this instead of assuming things about nx configuration
- If the user needs help with an Nx configuration or project graph error, use the `nx_workspace` tool to get any errors
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.

<!-- nx configuration end-->

## Nx Sandbox Notes

In some sandboxed environments, Nx daemon/plugin workers can fail to open local Unix sockets and commands may appear to hang before failing.

Use the workspace-safe wrapper for Nx commands:

```bash
npm run nx:safe -- run data-pipeline:lint
npm run nx:safe -- run-many -t lint
```

Equivalent direct command:

```bash
NX_DAEMON=false NX_ISOLATE_PLUGINS=false npx nx run data-pipeline:lint
```

## Imported CLAUDE.md Content

### Source: CLAUDE.md (repo root)


# Monorepo Architecture

## Apps

| App | Path | Stack | Description |
|-----|------|-------|-------------|
| web-platform | `apps/web-platform` | Next.js + Express/Prisma | Full-stack filing viewer (frontend, backend, shared workspaces) |
| serverless-functions | `apps/serverless-functions` | Go 1.23 + AWS Lambda | HKEX scraper services (scraper, downloader, orchestrator) |
| data-pipeline | `apps/data-pipeline` | Python + Docker + AWS Batch | Filing ETL pipeline (PDF extraction, DynamoDB, S3) |

Each app is fully isolated with zero cross-dependencies. `nx affected --target=deploy` only triggers the app that changed.

## Infrastructure

### Core Infrastructure (`infrastructure/core/`)

Centralized layer owning shared resources: VPC, S3 data lake buckets, and RDS. Publishes resource IDs via SSM Parameter Store for consumer apps.

| File | Resources |
|------|-----------|
| `vpc.tf` | VPC (10.0.0.0/16), 3 public subnets (ap-east-1a/b/c), IGW, route table |
| `s3.tf` | `pdfs-128638789653`, `filing-extractions-128638789653` (versioning, lifecycle: 90d→IA, 365d→Glacier) |
| `rds.tf` | `asiafilings-db` (db.t4g.micro, PostgreSQL 17.6), security group, subnet group |
| `ssm.tf` | 9 SSM parameters at `/platform/core/{env}/` |

Registered as Nx project `core-infrastructure` with `init`, `validate`, `plan`, `apply` targets.

### App-Level Infrastructure

Each app owns its own IaC for app-specific resources. Shared resources (VPC, S3, RDS) are resolved from SSM with a `var != "" ? var : ssm_lookup` pattern for backward compatibility.

| App | Infra Path | Resources |
|-----|-----------|-----------|
| web-platform | `apps/web-platform/infra/` | Terraform (EC2, EIP, security groups), deploy scripts, nginx config |
| serverless-functions | `apps/serverless-functions/infra/` | Terraform modules (Lambda, Step Functions, EventBridge, SQS) |
| data-pipeline | `apps/data-pipeline/infra/` | Terraform modules (Batch, DynamoDB, Quickwit, S3 notifications) |

## Terraform State Management

All Terraform roots use a shared S3 backend with DynamoDB locking. State files are versioned in S3 — no local `.tfstate` files.

**Backend resources (ap-east-1):**
- S3 bucket: `asiafilings-terraform-state` (versioned, encrypted, public access blocked)
- DynamoDB table: `asiafilings-terraform-lock` (prevents concurrent applies)

| Terraform Root | State Key |
|----------------|-----------|
| `infrastructure/core/` | `core/terraform.tfstate` |
| `apps/serverless-functions/infra/environments/prod/` | `serverless-functions/terraform.tfstate` |
| `apps/data-pipeline/infra/` | `data-pipeline/terraform.tfstate` |
| `apps/web-platform/infra/terraform/` | `web-platform/terraform.tfstate` |

### Workflow: Making Infrastructure Changes

```bash
# 1. Navigate to the Terraform root
cd apps/web-platform/infra/terraform  # (or any root above)

# 2. Initialize — downloads providers and connects to the S3 backend
#    (only needed once per machine, or after backend/provider changes)
terraform init

# 3. Preview changes — reads current state from S3, compares to config
terraform plan

# 4. Apply changes — acquires DynamoDB lock, applies, writes state to S3
terraform apply
```

`terraform init` pulls state from S3 automatically — there is no manual step to "download" state. The DynamoDB lock ensures only one person can `apply` at a time.

## Secret Management (AWS SSM Parameter Store)

Secrets are stored in SSM, never in the repo. The root `.gitignore` blocks `.env*`, `.pem`, `.key`, `.tfstate`, and credential files.

### SSM Path Convention

```
/platform/core/{env}/{KEY}     # Core infrastructure outputs (VPC, S3, RDS) — managed by Terraform
/platform/shared/{KEY}         # Shared secrets (DATABASE_URL, rds_password) — all services
/platform/{app}/{env}/{KEY}    # App-specific secrets
/platform/keys/{key-name}      # SSH private keys
```

App name mapping: `web-platform` -> `web`, `serverless-functions` -> `lambda`, `data-pipeline` -> `etl`

#### Core Infrastructure Parameters (`/platform/core/prod/`)

| Parameter | Value |
|-----------|-------|
| `vpc_id` | Core VPC ID |
| `subnet_ids` | Comma-separated public subnet IDs (3 AZs) |
| `s3_pdf_bucket` | `pdfs-128638789653` |
| `s3_pdf_bucket_arn` | S3 ARN for PDFs bucket |
| `s3_extraction_bucket` | `filing-extractions-128638789653` |
| `s3_extraction_bucket_arn` | S3 ARN for extractions bucket |
| `rds_endpoint` | `asiafilings-db...rds.amazonaws.com:5432` |
| `rds_host` | `asiafilings-db...rds.amazonaws.com` |
| `rds_security_group_id` | RDS security group ID |

These are published by `infrastructure/core/ssm.tf` and consumed by app-level Terraform via `data "aws_ssm_parameter"` lookups.

### Tooling

| Script | Purpose |
|--------|---------|
| `tools/scripts/migrate-local-to-ssm.js` | Reads local .env files, SSH keys, terraform.tfvars and generates `upload-secrets.sh` |
| `tools/scripts/upload-secrets.sh` | Generated script with `aws ssm put-parameter` commands (gitignored, contains secrets) |
| `tools/scripts/pull-secrets.sh` | Fetches env vars or SSH keys from SSM on demand |

### Workflows

```bash
# One-time: generate the upload script (review before running!)
node tools/scripts/migrate-local-to-ssm.js
bash tools/scripts/upload-secrets.sh

# Pull env vars for local dev (shared secrets are merged automatically)
./tools/scripts/pull-secrets.sh --app web --env dev
./tools/scripts/pull-secrets.sh --app lambda --env dev
./tools/scripts/pull-secrets.sh --app etl --env dev

# Pull an SSH key on demand
./tools/scripts/pull-secrets.sh --type keys --name asiafilings-hk-ec2 --output ~/.ssh/asiafilings.pem

# Deploy (SSH key fetched from SSM automatically, deleted on exit)
./apps/web-platform/scripts/deploy.sh .env.production
```

`pull-secrets.sh` always fetches `/platform/shared/` first, then app-specific secrets. App-specific values override shared ones if the same key exists in both.

### Available SSH Keys in SSM

| SSM Name | Description |
|----------|-------------|
| `asiafilings-hk-ec2` | EC2 deploy key for Hong Kong instance (18.167.27.8) |

## Dependency Isolation

Dependencies are kept at the app level, not hoisted to root:
- **Node** (web-platform): `apps/web-platform/package.json` with nested workspaces (frontend, backend, shared)
- **Go** (serverless-functions): `apps/serverless-functions/go.mod` (module: `github.com/nicholaszhao/hkex-scraper`)
- **Python** (data-pipeline): `apps/data-pipeline/etl_worker/requirements.txt` + `apps/data-pipeline/pyproject.toml`

### Source: apps/web-platform/CLAUDE.md

# AsiaFilings Project

## Deployment

**Deploy to EC2:**
```bash
./scripts/deploy.sh .env.production
```

**Server:** 18.167.27.8 (EC2 t4g.medium, Hong Kong ap-east-1)

**Access:**
- Frontend: http://18.167.27.8 (via nginx)
- API: http://18.167.27.8/api (proxied to backend)

## Project Structure

```
AsiaFilings/
├── frontend/src/       # Next.js 14 app
│   ├── app/            # Routes
│   ├── components/     # UI components
│   └── services/       # API calls
├── backend/            # Fastify API
│   ├── src/            # Source code
│   └── prisma/         # Database schema
├── shared/             # Shared TypeScript types
└── scripts/            # Deployment scripts
```

## AWS Infrastructure

All shared resources (VPC, RDS, S3 data lake) are managed by `infrastructure/core/` and published via SSM at `/platform/core/prod/`. App-level Terraform in `infra/terraform/` reads these via SSM lookups.

### Database (RDS PostgreSQL) — managed by `infrastructure/core/`
- **Host:** asiafilings-db.cfq288k0iepj.ap-east-1.rds.amazonaws.com
- **Region:** ap-east-1 (Hong Kong)
- **Database:** postgres
- **User:** postgres
- **Port:** 5432
- **VPC:** Core VPC (10.0.0.0/16)

### S3 Buckets (ap-east-1) — managed by `infrastructure/core/`
- **PDFs:** pdfs-128638789653
- **Table Extractions:** filing-extractions-128638789653

### EC2 (ap-east-1)
- **Instance:** t4g.medium (ARM/Graviton, 2 vCPU, 4GB RAM)
- **IP:** 18.167.27.8
- **SSH Key:** asiafilings-hk-key.pem (in infrastructure/ec2/)

## Environment Files

| File | Purpose |
|------|---------|
| `.env` | Docker Compose local development |
| `.env.development` | Local development (connects to RDS) |
| `.env.production` | Production deployment |

**Note:** `.env*` files are gitignored. Update directly on server for production.

## Database

- **PostgreSQL** on AWS RDS (Hong Kong region)
- **Prisma** ORM for queries (schema at `backend/prisma/schema.prisma`)
- Seed test users: `npm run seed:users` (from backend/)

## Quick Commands

```bash
# Local development
npm run dev                    # Start frontend + backend

# Deploy to production
./scripts/deploy.sh .env.production

# SSH to EC2
ssh -i infrastructure/ec2/asiafilings-hk-key.pem ec2-user@18.167.27.8

# Update production database URL
ssh -i infrastructure/ec2/asiafilings-hk-key.pem ec2-user@18.167.27.8 \
  "cd ~/AsiaFilings && sed -i 's|DATABASE_URL=.*|DATABASE_URL=<new-url>|' .env"
```
