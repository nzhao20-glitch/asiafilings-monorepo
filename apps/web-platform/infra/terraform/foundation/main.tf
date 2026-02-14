# AsiaFilings Foundation Infrastructure
# One-time resources that rarely change: state backend, S3, secrets
#
# Usage:
#   cd infrastructure/terraform/foundation
#   terraform init
#   terraform plan
#   terraform apply
#
# After applying, migrate to remote state:
#   terraform init -migrate-state

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment after first apply to migrate to remote state
  # backend "s3" {
  #   bucket         = "asiafilings-terraform-state"
  #   key            = "foundation/terraform.tfstate"
  #   region         = "ap-east-1"
  #   encrypt        = true
  #   dynamodb_table = "asiafilings-terraform-lock"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AsiaFilings"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Layer       = "Foundation"
    }
  }
}

# State Backend (S3 + DynamoDB for state locking)
module "state_backend" {
  source = "./modules/state-backend"

  project_name = var.project_name
  environment  = var.environment
}

# S3 Bucket for document storage
module "s3" {
  source = "./modules/s3"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region
}

# AWS Secrets Manager for application secrets
module "secrets" {
  source = "./modules/secrets"

  project_name = var.project_name
  environment  = var.environment
}

# Outputs for application layer to reference
output "state_bucket_name" {
  description = "Name of the S3 bucket for Terraform state"
  value       = module.state_backend.state_bucket_name
}

output "state_lock_table_name" {
  description = "Name of the DynamoDB table for state locking"
  value       = module.state_backend.lock_table_name
}

output "documents_bucket_name" {
  description = "Name of the S3 bucket for document storage"
  value       = module.s3.bucket_name
}

output "documents_bucket_arn" {
  description = "ARN of the S3 bucket for document storage"
  value       = module.s3.bucket_arn
}

output "secrets_arns" {
  description = "Map of secret names to ARNs"
  value       = module.secrets.secret_arns
  sensitive   = true
}
