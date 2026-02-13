terraform {
  required_version = ">= 1.0"

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
    tags = merge(var.tags, {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "terraform"
    })
  }
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"
}

# S3 Module - Buckets and SQS Notification
module "s3" {
  source = "./modules/s3"

  project_name     = var.project_name
  environment      = var.environment
  bucket_raw       = var.bucket_raw
  bucket_processed = var.bucket_processed
  create_buckets   = var.create_buckets
}

# DynamoDB Module - Job Tracking Tables
module "dynamodb" {
  source = "./modules/dynamodb"

  project_name = var.project_name
  environment  = var.environment
  name_prefix  = local.name_prefix
}

# Batch Module - Compute Environment, Job Queue, Job Definition
module "batch" {
  source = "./modules/batch"

  project_name        = var.project_name
  environment         = var.environment
  name_prefix         = local.name_prefix
  vpc_id              = var.vpc_id
  subnet_ids          = var.subnet_ids
  ecr_image_uri       = var.ecr_image_uri
  batch_vcpus         = var.batch_vcpus
  batch_memory        = var.batch_memory
  chunk_size          = var.chunk_size
  bucket_raw          = var.bucket_raw
  bucket_processed    = var.bucket_processed
  enable_job_tracking = true

  depends_on = [module.dynamodb]
}

# Quickwit Module - Two-Node Cluster (Indexer + Searcher)
module "quickwit" {
  source = "./modules/quickwit"

  project_name           = var.project_name
  environment            = var.environment
  name_prefix            = local.name_prefix
  vpc_id                 = var.vpc_id
  subnet_id              = var.subnet_ids[0]
  indexer_instance_types  = var.quickwit_indexer_instance_types
  searcher_instance_types = var.quickwit_searcher_instance_types
  key_pair               = var.quickwit_key_pair
  quickwit_version       = var.quickwit_version
  rds_host               = var.rds_host
  rds_password           = var.rds_password
  bucket_raw             = var.bucket_raw
  bucket_processed       = var.bucket_processed
  sqs_queue_arn          = module.s3.sqs_queue_arn
  sqs_queue_url          = module.s3.sqs_queue_url
}
