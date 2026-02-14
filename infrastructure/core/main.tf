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
