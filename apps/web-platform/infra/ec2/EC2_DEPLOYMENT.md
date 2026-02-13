# AsiaFilings EC2 Deployment Guide

Deploy AsiaFilings on AWS EC2 (Free Tier) with RDS PostgreSQL.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐
│   dartscrape    │────▶│  RDS PostgreSQL │◀────┐
│   (Lambda)      │     │  (db.t3.micro)  │     │
│  - Sync DART    │     └─────────────────┘     │
│  - Extract tables│                            │
└─────────────────┘                             │
                                                │
                        ┌─────────────────────┐ │
                        │   EC2 (t2.micro)    │─┘
                        │  ┌───────────────┐  │
                        │  │ Nginx (80)    │  │
                        │  │ Frontend(3000)│  │
                        │  │ Backend (3001)│  │  Reads: companies, filings
                        │  │ Redis (6379)  │  │  Writes: users, sessions
                        │  └───────────────┘  │
                        └─────────────────────┘
```

**Data Flow:**
- **dartscrape Lambda**: Populates companies, filings, extracted_tables
- **AsiaFilings Backend**: Reads filing data, manages user authentication
- **AsiaFilings sync workers**: DISABLED (dartscrape handles sync)

## Cost Estimate

| Resource | Free Tier (12 months) | After Free Tier |
|----------|----------------------|-----------------|
| EC2 t2.micro (750 hrs/mo) | $0 | ~$8-10/mo |
| EBS 20GB gp2 | $0 | ~$2/mo |
| Elastic IP | $0 (attached) | $0 |
| RDS db.t3.micro (750 hrs/mo) | $0 | ~$13-15/mo |
| RDS Storage 20GB | $0 | ~$2/mo |
| **Total** | **$0** | **~$25-30/mo** |

## Prerequisites

1. **AWS Account** with Free Tier eligibility
2. **AWS CLI** installed and configured
3. **Git** access to AsiaFilings repository

```bash
# Install AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Configure credentials
aws configure
# Enter: Access Key ID, Secret Access Key, Region (ap-northeast-2), Output (json)
```

---

## Step 1: Create Security Groups

### EC2 Security Group

```bash
# Create EC2 security group
aws ec2 create-security-group \
  --group-name asiafilings-ec2-sg \
  --description "AsiaFilings EC2 security group"

# Allow SSH from your IP (replace YOUR_IP)
aws ec2 authorize-security-group-ingress \
  --group-name asiafilings-ec2-sg \
  --protocol tcp --port 22 \
  --cidr YOUR_IP/32

# Allow HTTP
aws ec2 authorize-security-group-ingress \
  --group-name asiafilings-ec2-sg \
  --protocol tcp --port 80 \
  --cidr 0.0.0.0/0

# Allow HTTPS
aws ec2 authorize-security-group-ingress \
  --group-name asiafilings-ec2-sg \
  --protocol tcp --port 443 \
  --cidr 0.0.0.0/0
```

### RDS Security Group

```bash
# Create RDS security group
aws ec2 create-security-group \
  --group-name asiafilings-rds-sg \
  --description "AsiaFilings RDS security group"

# Get EC2 security group ID
EC2_SG_ID=$(aws ec2 describe-security-groups \
  --group-names asiafilings-ec2-sg \
  --query 'SecurityGroups[0].GroupId' --output text)

# Allow PostgreSQL from EC2
aws ec2 authorize-security-group-ingress \
  --group-name asiafilings-rds-sg \
  --protocol tcp --port 5432 \
  --source-group $EC2_SG_ID
```

---

## Step 2: Create RDS PostgreSQL Instance

```bash
# Get RDS security group ID
RDS_SG_ID=$(aws ec2 describe-security-groups \
  --group-names asiafilings-rds-sg \
  --query 'SecurityGroups[0].GroupId' --output text)

# Create RDS instance (Free Tier eligible)
aws rds create-db-instance \
  --db-instance-identifier asiafilings-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username asiafilings \
  --master-user-password 'YOUR_SECURE_PASSWORD_HERE' \
  --allocated-storage 20 \
  --vpc-security-group-ids $RDS_SG_ID \
  --db-name asiafilings_db \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --storage-type gp2

# Wait for RDS to be available (takes 5-10 minutes)
aws rds wait db-instance-available --db-instance-identifier asiafilings-db

# Get RDS endpoint
aws rds describe-db-instances \
  --db-instance-identifier asiafilings-db \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

**Save the RDS endpoint** - you'll need it for the .env file.

---

## Step 3: Create EC2 Instance

### Create Key Pair

```bash
aws ec2 create-key-pair \
  --key-name asiafilings-key \
  --query 'KeyMaterial' --output text > asiafilings-key.pem

chmod 400 asiafilings-key.pem
```

### Launch Instance

```bash
# Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-*-x86_64" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' --output text)

# Get EC2 security group ID
EC2_SG_ID=$(aws ec2 describe-security-groups \
  --group-names asiafilings-ec2-sg \
  --query 'SecurityGroups[0].GroupId' --output text)

# Launch EC2 instance
aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --key-name asiafilings-key \
  --security-group-ids $EC2_SG_ID \
  --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":20,"VolumeType":"gp2"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=asiafilings-prod}]'
```

### Allocate Elastic IP

```bash
# Allocate Elastic IP
ALLOCATION_ID=$(aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text)

# Get instance ID
INSTANCE_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=asiafilings-prod" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Associate Elastic IP
aws ec2 associate-address --instance-id $INSTANCE_ID --allocation-id $ALLOCATION_ID

# Get Elastic IP address
aws ec2 describe-addresses --allocation-ids $ALLOCATION_ID --query 'Addresses[0].PublicIp' --output text
```

**Save the Elastic IP** - this is your server's public address.

---

## Step 4: Configure EC2 Instance

SSH into the instance:

```bash
ssh -i asiafilings-key.pem ec2-user@YOUR_ELASTIC_IP
```

### Install Dependencies

```bash
# Update system
sudo dnf update -y

# Set timezone
sudo timedatectl set-timezone Asia/Seoul

# Install Docker
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Install Nginx
sudo dnf install -y nginx
sudo systemctl enable nginx

# Log out and back in for Docker group
exit
```

### Create Swap Space

```bash
ssh -i asiafilings-key.pem ec2-user@YOUR_ELASTIC_IP

# Create 2GB swap
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Optimize for low memory
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

## Step 5: Deploy Application

### Clone Repository

```bash
sudo mkdir -p /opt/asiafilings
sudo chown ec2-user:ec2-user /opt/asiafilings
cd /opt/asiafilings
git clone https://github.com/YOUR_USERNAME/AsiaFilings.git .
```

### Configure Environment

```bash
# Copy example config
cp infrastructure/ec2/.env.production.example .env

# Edit with your values
nano .env
```

**Required changes in .env:**
- `DATABASE_URL`: Replace with your RDS endpoint
- `JWT_SECRET`: Generate with `openssl rand -base64 48`
- `JWT_REFRESH_SECRET`: Generate with `openssl rand -base64 48`
- `COOKIE_SECRET`: Generate with `openssl rand -base64 24`
- `FRONTEND_URL`: `http://YOUR_ELASTIC_IP`
- `NEXT_PUBLIC_API_URL`: `http://YOUR_ELASTIC_IP/api`
- `CORS_ORIGIN`: `http://YOUR_ELASTIC_IP`

### Configure Nginx

```bash
sudo cp infrastructure/ec2/nginx-asiafilings.conf /etc/nginx/conf.d/asiafilings.conf
sudo rm -f /etc/nginx/conf.d/default.conf
sudo nginx -t
sudo systemctl start nginx
```

### Build and Start

```bash
cd /opt/asiafilings

# Build containers
docker compose -f docker-compose.prod.yml build

# Start services
docker compose -f docker-compose.prod.yml up -d

# Run database migrations
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Verify
docker compose -f docker-compose.prod.yml ps
```

---

## Step 6: Verify Deployment

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check backend health
curl http://localhost:3001/health

# Check frontend
curl http://localhost:3000

# Check via Nginx
curl http://YOUR_ELASTIC_IP/api/health
```

Access the application at: `http://YOUR_ELASTIC_IP`

---

## Maintenance

### View Logs

```bash
# All logs
docker compose -f docker-compose.prod.yml logs -f

# Backend only
docker compose -f docker-compose.prod.yml logs -f backend

# Frontend only
docker compose -f docker-compose.prod.yml logs -f frontend
```

### Deploy Updates

```bash
cd /opt/asiafilings
chmod +x infrastructure/ec2/deploy.sh
./infrastructure/ec2/deploy.sh
```

### Restart Services

```bash
docker compose -f docker-compose.prod.yml restart
```

### Database Backup

RDS handles backups automatically (7-day retention). For manual backups:

```bash
# Create manual snapshot via AWS CLI
aws rds create-db-snapshot \
  --db-instance-identifier asiafilings-db \
  --db-snapshot-identifier asiafilings-manual-$(date +%Y%m%d)
```

---

## SSL/HTTPS Setup (Optional)

For production with a domain name:

```bash
# Install Certbot
sudo dnf install -y certbot python3-certbot-nginx

# Get certificate (requires domain pointing to Elastic IP)
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo systemctl enable certbot-renew.timer
```

---

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs backend

# Check if RDS is accessible
nc -zv YOUR_RDS_ENDPOINT 5432
```

### Database connection issues

```bash
# Verify DATABASE_URL in .env
grep DATABASE_URL .env

# Test connection from container
docker compose -f docker-compose.prod.yml exec backend npx prisma db pull
```

### Memory issues

```bash
# Check memory usage
free -h
docker stats --no-stream

# If swap is heavily used, consider upgrading to t3.small
```

### Nginx not routing correctly

```bash
# Check Nginx config
sudo nginx -t

# Check if services are listening
curl http://localhost:3000
curl http://localhost:3001/health
```

---

## Cleanup

To tear down the deployment:

```bash
# Stop and remove containers
docker compose -f docker-compose.prod.yml down -v

# Terminate EC2 instance
aws ec2 terminate-instances --instance-ids $INSTANCE_ID

# Release Elastic IP
aws ec2 release-address --allocation-id $ALLOCATION_ID

# Delete RDS instance (WARNING: This deletes all data)
aws rds delete-db-instance \
  --db-instance-identifier asiafilings-db \
  --skip-final-snapshot

# Delete security groups
aws ec2 delete-security-group --group-name asiafilings-ec2-sg
aws ec2 delete-security-group --group-name asiafilings-rds-sg

# Delete key pair
aws ec2 delete-key-pair --key-name asiafilings-key
rm asiafilings-key.pem
```

---

## Memory Budget

| Service | Memory Limit |
|---------|-------------|
| Redis | 50MB |
| Backend | 512MB |
| Frontend | 300MB |
| **Total** | **862MB** |

With 4GB RAM on t4g.medium, this leaves ~2.9GB headroom plus 2GB swap.

---

## Related Files

- `docker-compose.prod.yml` - Production Docker Compose config
- `frontend/Dockerfile.prod` - Production frontend build
- `infrastructure/ec2/nginx-asiafilings.conf` - Nginx configuration
- `infrastructure/ec2/.env.production.example` - Environment template
- `infrastructure/ec2/deploy.sh` - Deployment script
