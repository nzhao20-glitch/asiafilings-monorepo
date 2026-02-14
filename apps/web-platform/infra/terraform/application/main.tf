# AsiaFilings Application Infrastructure
# Per-deployment resources: ECR, ECS, ALB, Security Groups
#
# Prerequisites:
#   - Foundation layer must be applied first
#   - Update backend config with foundation outputs
#
# Usage:
#   cd infrastructure/terraform/application
#   terraform init
#   terraform plan
#   terraform apply

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Uncomment after foundation layer is applied
  # backend "s3" {
  #   bucket         = "asiafilings-terraform-state"
  #   key            = "application/terraform.tfstate"
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
      Layer       = "Application"
    }
  }
}

# Reference foundation layer outputs via remote state
# Uncomment after foundation layer is applied
# data "terraform_remote_state" "foundation" {
#   backend = "s3"
#   config = {
#     bucket = "asiafilings-terraform-state"
#     key    = "foundation/terraform.tfstate"
#     region = "ap-east-1"
#   }
# }

# Data sources
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# =============================================================================
# VPC Resolution — Default VPC or Core VPC from SSM
# =============================================================================

# Default VPC (only when use_default_vpc = true)
data "aws_vpc" "main" {
  count   = var.use_default_vpc ? 1 : 0
  default = true
}

data "aws_subnets" "public" {
  count = var.use_default_vpc ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main[0].id]
  }

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
}

# Core VPC from SSM (when use_default_vpc = false)
data "aws_ssm_parameter" "vpc_id" {
  count = var.use_default_vpc ? 0 : 1
  name  = "/platform/core/${var.environment}/vpc_id"
}

data "aws_ssm_parameter" "subnet_ids" {
  count = var.use_default_vpc ? 0 : 1
  name  = "/platform/core/${var.environment}/subnet_ids"
}

locals {
  vpc_id     = var.use_default_vpc ? data.aws_vpc.main[0].id : data.aws_ssm_parameter.vpc_id[0].value
  subnet_ids = var.use_default_vpc ? data.aws_subnets.public[0].ids : split(",", data.aws_ssm_parameter.subnet_ids[0].value)
}

# ECR Repository for Docker images
module "ecr" {
  source = "./modules/ecr"

  repository_name = "${var.project_name}-backend"
  environment     = var.environment
}

# Application Load Balancer
module "alb" {
  source = "./modules/alb"

  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = local.vpc_id
  public_subnets  = local.subnet_ids
  certificate_arn = var.acm_certificate_arn
}

# Security Groups
module "security_groups" {
  source = "./modules/security-groups"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = local.vpc_id
  alb_sg_id    = module.alb.alb_security_group_id
}

# ECS Cluster and Service
module "ecs" {
  source = "./modules/ecs"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  # Networking
  vpc_id              = local.vpc_id
  private_subnets     = local.subnet_ids
  ecs_security_groups = [module.security_groups.ecs_security_group_id]

  # Load Balancer
  alb_target_group_arn = module.alb.target_group_arn

  # Container
  ecr_repository_url = module.ecr.repository_url
  container_port     = var.container_port

  # Resources
  cpu    = var.ecs_task_cpu
  memory = var.ecs_task_memory

  # Scaling
  desired_count = var.ecs_desired_count
  min_count     = var.ecs_min_count
  max_count     = var.ecs_max_count

  # Environment variables
  environment_variables = {
    NODE_ENV     = "production"
    HOST         = "0.0.0.0"
    PORT         = tostring(var.container_port)
    LOG_LEVEL    = var.log_level
    FRONTEND_URL = var.frontend_url
    AWS_REGION   = var.aws_region
    S3_BUCKET    = var.s3_bucket_name
  }

  # Secrets from AWS Secrets Manager
  # Use foundation outputs when remote state is enabled:
  # secrets = {
  #   DATABASE_URL       = data.terraform_remote_state.foundation.outputs.database_url_secret_arn
  #   JWT_SECRET         = data.terraform_remote_state.foundation.outputs.jwt_secret_arn
  #   JWT_REFRESH_SECRET = data.terraform_remote_state.foundation.outputs.jwt_refresh_secret_arn
  #   COOKIE_SECRET      = data.terraform_remote_state.foundation.outputs.cookie_secret_arn
  # }

  # Manual ARNs (use until foundation is applied)
  secrets = {
    DATABASE_URL       = var.database_url_secret_arn
    JWT_SECRET         = var.jwt_secret_arn
    JWT_REFRESH_SECRET = var.jwt_refresh_secret_arn
    COOKIE_SECRET      = var.cookie_secret_arn
  }
}
