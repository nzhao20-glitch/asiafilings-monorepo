# =============================================================================
# Web Platform — EC2 Infrastructure
# =============================================================================
# Manages the production EC2 instance, security group, and Elastic IP.
# These resources were created manually and imported into Terraform state.
#
# The EC2 instance runs in the default VPC (172.31.0.0/16), NOT the core VPC.
# Core infrastructure (RDS, S3 buckets) is managed separately in
# infrastructure/core/ and accessed via SSM Parameter Store.
# =============================================================================

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
    key            = "web-platform/terraform.tfstate"
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
      App         = "web-platform"
    }
  }
}

# -----------------------------------------------------------------------------
# Data Sources
# -----------------------------------------------------------------------------

data "aws_vpc" "default" {
  default = true
}

data "aws_subnet" "ec2" {
  id = var.subnet_id
}
