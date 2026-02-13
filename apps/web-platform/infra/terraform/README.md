# AsiaFilings Terraform Infrastructure

This directory contains Terraform configurations for deploying AsiaFilings to AWS. The infrastructure is organized into two layers:

## Directory Structure

```
terraform/
├── foundation/           # One-time setup resources
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   └── modules/
│       ├── state-backend/  # S3 + DynamoDB for Terraform state
│       ├── s3/             # Document storage bucket
│       └── secrets/        # AWS Secrets Manager secrets
│
├── application/          # Per-deployment resources
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars.example
│   └── modules/
│       ├── ecr/            # Container registry
│       ├── ecs/            # ECS cluster and service
│       ├── alb/            # Application Load Balancer
│       └── security-groups/
│
└── README.md
```

## Foundation Layer

Resources that rarely change and are shared across deployments:

- **State Backend**: S3 bucket and DynamoDB table for Terraform remote state
- **S3 Bucket**: Document storage with lifecycle policies
- **Secrets**: AWS Secrets Manager secrets for database URL, JWT secrets, etc.

### Deploy Foundation

```bash
cd infrastructure/terraform/foundation

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars

# Initialize and apply
terraform init
terraform plan
terraform apply
```

After applying, update the secrets in AWS Secrets Manager with actual values:

```bash
# Example: Update database URL secret
aws secretsmanager put-secret-value \
  --secret-id asiafilings/prod/database-url \
  --secret-string "postgresql://user:pass@host:5432/db"
```

Then enable remote state by uncommenting the backend block in `main.tf` and running:

```bash
terraform init -migrate-state
```

## Application Layer

Resources for the running application:

- **ECR**: Container registry for Docker images
- **ECS**: Fargate cluster, task definition, and service
- **ALB**: Application Load Balancer with health checks
- **Security Groups**: Network security rules

### Deploy Application

```bash
cd infrastructure/terraform/application

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Fill in secret ARNs from foundation outputs

# Initialize and apply
terraform init
terraform plan
terraform apply
```

### Build and Push Docker Image

After deploying, build and push your Docker image:

```bash
# Get ECR login
aws ecr get-login-password --region ap-northeast-2 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.ap-northeast-2.amazonaws.com

# Build and push
docker build -t asiafilings-backend -f backend/Dockerfile.prod .
docker tag asiafilings-backend:latest <ecr-url>:latest
docker push <ecr-url>:latest

# Force new deployment
aws ecs update-service --cluster asiafilings-prod-cluster --service asiafilings-prod-service --force-new-deployment
```

## Cost Optimization

The default configuration is optimized for low cost:

- ECS Fargate with 0.25 vCPU / 512MB memory
- Single task (scales to 3 under load)
- S3 lifecycle policies move old documents to cheaper storage
- Pay-per-request DynamoDB for state locking

## Cleanup

To destroy resources:

```bash
# Application layer first
cd infrastructure/terraform/application
terraform destroy

# Then foundation (will fail if state bucket has objects)
cd ../foundation
terraform destroy
```

Note: The state bucket has `prevent_destroy` enabled. Remove this lifecycle rule before destroying.
