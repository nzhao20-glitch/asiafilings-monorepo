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

### Database (RDS PostgreSQL)
- **Host:** asiafilings-db.cfq288k0iepj.ap-east-1.rds.amazonaws.com
- **Region:** ap-east-1 (Hong Kong)
- **Database:** postgres
- **User:** postgres
- **Port:** 5432

### S3 Buckets (ap-east-1)
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
