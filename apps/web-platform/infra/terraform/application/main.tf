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
  #   region         = "ap-northeast-2"
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
#     region = "ap-northeast-2"
#   }
# }

# Data sources
data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# VPC (use existing or default)
data "aws_vpc" "main" {
  default = var.use_default_vpc
}

data "aws_subnets" "public" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.main.id]
  }

  filter {
    name   = "map-public-ip-on-launch"
    values = ["true"]
  }
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
  vpc_id          = data.aws_vpc.main.id
  public_subnets  = data.aws_subnets.public.ids
  certificate_arn = var.acm_certificate_arn
}

# Security Groups
module "security_groups" {
  source = "./modules/security-groups"

  project_name = var.project_name
  environment  = var.environment
  vpc_id       = data.aws_vpc.main.id
  alb_sg_id    = module.alb.alb_security_group_id
}

# ECS Cluster and Service
module "ecs" {
  source = "./modules/ecs"

  project_name = var.project_name
  environment  = var.environment
  aws_region   = var.aws_region

  # Networking
  vpc_id              = data.aws_vpc.main.id
  private_subnets     = data.aws_subnets.public.ids
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
