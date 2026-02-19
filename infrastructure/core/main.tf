# =============================================================================
# Core Infrastructure — Provider, Locals, Data Sources
# =============================================================================
# Owns VPC, S3 data lake buckets, and RDS. Publishes resource IDs via SSM
# Parameter Store for consumer apps (web-platform, serverless-functions,
# data-pipeline).

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "asiafilings-terraform-state"
    key            = "core/terraform.tfstate"
    region         = "ap-east-1"
    dynamodb_table = "asiafilings-terraform-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "AsiaFilings"
      Environment = var.environment
      ManagedBy   = "Terraform"
      Layer       = "Core"
    }
  }
}

locals {
  name_prefix = "asiafilings-core-${var.environment}"
}

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ssm_parameters_by_path" "shared" {
  path            = "/platform/shared/"
  recursive       = false
  with_decryption = true
}

locals {
  shared_ssm_parameters        = zipmap(data.aws_ssm_parameters_by_path.shared.names, data.aws_ssm_parameters_by_path.shared.values)
  rds_password_from_ssm        = lookup(local.shared_ssm_parameters, "/platform/shared/RDS_PASSWORD", "")
  rds_password_legacy_from_ssm = lookup(local.shared_ssm_parameters, "/platform/shared/rds_password", "")
  rds_password = var.rds_password != "" ? var.rds_password : (
    local.rds_password_from_ssm != "" ? local.rds_password_from_ssm : local.rds_password_legacy_from_ssm
  )
}
