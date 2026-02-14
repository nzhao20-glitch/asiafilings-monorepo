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

# Monorepo Architecture

## Apps

| App | Path | Stack | Description |
|-----|------|-------|-------------|
| web-platform | `apps/web-platform` | Next.js + Express/Prisma | Full-stack filing viewer (frontend, backend, shared workspaces) |
| serverless-functions | `apps/serverless-functions` | Go 1.23 + AWS Lambda | HKEX scraper services (scraper, downloader, orchestrator) |
| data-pipeline | `apps/data-pipeline` | Python + Docker + AWS Batch | Filing ETL pipeline (PDF extraction, DynamoDB, S3) |

Each app is fully isolated with zero cross-dependencies. `nx affected --target=deploy` only triggers the app that changed.

## Infrastructure (Independent Deployability)

Each app owns its own IaC — there is NO central `infrastructure/` folder.

| App | Infra Path | Resources |
|-----|-----------|-----------|
| web-platform | `apps/web-platform/infra/` | Terraform (ECS, ALB, ECR, S3), EC2 deploy scripts, nginx config |
| serverless-functions | `apps/serverless-functions/infra/` | Terraform modules (Lambda, EventBridge, SQS, Step Functions) |
| data-pipeline | `apps/data-pipeline/infra/` | Terraform modules (Batch, DynamoDB, S3, Quickwit) |

## Secret Management (AWS SSM Parameter Store)

Secrets are stored in SSM, never in the repo. The root `.gitignore` blocks `.env*`, `.pem`, `.key`, `.tfstate`, and credential files.

### SSM Path Convention

```
/platform/{app}/{env}/{KEY}    # Environment variables
/platform/keys/{key-name}      # SSH private keys
```

App name mapping: `web-platform` -> `web`, `serverless-functions` -> `lambda`, `data-pipeline` -> `etl`

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

# Pull env vars for local dev
./tools/scripts/pull-secrets.sh --app web --env dev
./tools/scripts/pull-secrets.sh --app lambda --env dev
./tools/scripts/pull-secrets.sh --app etl --env dev

# Pull an SSH key on demand
./tools/scripts/pull-secrets.sh --type keys --name asiafilings-hk-ec2 --output ~/.ssh/asiafilings.pem

# Deploy (SSH key fetched from SSM automatically, deleted on exit)
./apps/web-platform/scripts/deploy.sh .env.production
```

### Available SSH Keys in SSM

| SSM Name | Description |
|----------|-------------|
| `asiafilings-hk-ec2` | EC2 deploy key for Hong Kong instance (18.167.27.8) |

## Dependency Isolation

Dependencies are kept at the app level, not hoisted to root:
- **Node** (web-platform): `apps/web-platform/package.json` with nested workspaces (frontend, backend, shared)
- **Go** (serverless-functions): `apps/serverless-functions/go.mod` (module: `github.com/nicholaszhao/hkex-scraper`)
- **Python** (data-pipeline): `apps/data-pipeline/etl_worker/requirements.txt` + `apps/data-pipeline/pyproject.toml`
