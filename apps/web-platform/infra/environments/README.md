# AsiaFilings Environment Configuration

This directory contains environment configuration templates for multi-stage deployments.

## Directory Structure

```
environments/
├── .env.beta.template       # Beta environment (testing new features)
├── .env.gamma.template      # Gamma environment (pre-production staging)
├── .env.production.template # Production environment
└── README.md
```

## Usage

### 1. Create your actual environment file

Copy the appropriate template and fill in your actual values:

```bash
# For production
cp .env.production.template .env.production

# Edit with your actual secrets
nano .env.production
```

### 2. Deploy to EC2

Copy the environment file to your EC2 instance:

```bash
# Production
scp -i path/to/key.pem .env.production ec2-user@prod-ip:~/asiafilings/.env

# Beta
scp -i path/to/key.pem .env.beta ec2-user@beta-ip:~/asiafilings/.env

# Gamma
scp -i path/to/key.pem .env.gamma ec2-user@gamma-ip:~/asiafilings/.env
```

### 3. Restart services

On the EC2 instance:

```bash
cd ~/asiafilings
docker compose -f docker-compose.prod.yml up -d
```

## Environment Isolation Best Practices

1. **Separate databases** - Each environment should have its own database
2. **Separate S3 buckets** - Use different buckets: `asiafilings-documents-beta`, `-gamma`, `-prod`
3. **Different secrets** - Generate unique JWT_SECRET, COOKIE_SECRET for each environment
4. **Separate AWS credentials** - Consider using different IAM users per environment

## Generating Secrets

```bash
# Generate JWT_SECRET (64 characters)
openssl rand -base64 48

# Generate COOKIE_SECRET (32 characters)
openssl rand -base64 24
```

## Security Notes

- **NEVER** commit actual `.env` files with real secrets to git
- Only `.template` files should be committed
- Add `.env.*` (without .template) to `.gitignore`
- Consider using AWS Secrets Manager for production secrets
