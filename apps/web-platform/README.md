# AsiaFilings - Asian Market Filing Viewer

Enterprise web application for viewing and analyzing DART/HKEX filings for institutional investors.

## Tech Stack

- **Frontend**: Next.js 14 with TypeScript, TailwindCSS
- **Backend**: Fastify with TypeScript, Prisma ORM
- **Database**: PostgreSQL 16 (AWS RDS)
- **Cache**: Redis
- **Storage**: AWS S3 (Hong Kong region)
- **Infrastructure**: AWS EC2 (Hong Kong) + RDS

## Project Structure

```
AsiaFilings/
├── frontend/src/       # Next.js application
├── backend/            # Fastify API server
├── shared/             # Shared TypeScript types
├── scripts/            # Deployment scripts
└── infrastructure/     # Terraform configs
```

## Quick Start (Local Development)

### Prerequisites

- Node.js 20+
- Docker Desktop (for Redis)

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env.development
# Edit .env.development with your settings
```

### 3. Start Development

```bash
# Start Redis (required for backend)
docker compose up -d redis

# Start frontend + backend
npm run dev
```

### 4. Access Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **API Docs**: http://localhost:3001/documentation

## Production Deployment

### AWS Infrastructure

| Service | Region | Details |
|---------|--------|---------|
| EC2 t4g.medium | ap-east-1 (Hong Kong) | 18.167.27.8 |
| RDS PostgreSQL | ap-east-1 (Hong Kong) | asiafilings-db.cfq288k0iepj.ap-east-1.rds.amazonaws.com |
| S3 Buckets | ap-east-1 (Hong Kong) | pdfs-128638789653, filing-extractions-128638789653 |

### Deploy

```bash
./scripts/deploy.sh .env.production
```

### SSH Access

```bash
ssh -i infrastructure/ec2/asiafilings-hk-key.pem ec2-user@18.167.27.8
```

### Production URLs

- **Frontend**: http://18.167.27.8
- **API**: http://18.167.27.8/api

## Database

The application uses AWS RDS PostgreSQL in Hong Kong region.

```bash
# Connect to production database (requires VPN/bastion or public access)
psql postgresql://postgres:PASSWORD@asiafilings-db.cfq288k0iepj.ap-east-1.rds.amazonaws.com:5432/postgres
```

### Prisma Commands

```bash
cd backend

npx prisma studio      # Open database GUI
npx prisma generate    # Generate Prisma client
npx prisma migrate dev # Create migration
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend |
| `npm run build` | Build all workspaces |
| `npm run lint` | Lint all workspaces |
| `./scripts/deploy.sh` | Deploy to production |

## Environment Variables

Key variables (see `.env.example` for full list):

```bash
DATABASE_URL=postgresql://...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_REGION=ap-east-1
JWT_SECRET=...
```

## Features

- PDF document viewer with table of contents
- Table overlay with bounding boxes
- Multi-format support (PDF, HTM, DOC)
- Company search with autocomplete
- JWT authentication
- Background job processing

## License

Private - All rights reserved
