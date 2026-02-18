terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "asiafilings-terraform-state"
    key            = "data-pipeline/terraform.tfstate"
    region         = "ap-east-1"
    dynamodb_table = "asiafilings-terraform-lock"
    encrypt        = true
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

# =============================================================================
# SSM Lookups — Resolve core infrastructure from SSM Parameter Store
# =============================================================================

data "aws_ssm_parameter" "vpc_id" {
  name = "/platform/core/${var.environment}/vpc_id"
}

data "aws_ssm_parameter" "subnet_ids" {
  name = "/platform/core/${var.environment}/subnet_ids"
}

data "aws_ssm_parameter" "s3_pdf_bucket" {
  name = "/platform/core/${var.environment}/s3_pdf_bucket"
}

data "aws_ssm_parameter" "s3_extraction_bucket" {
  name = "/platform/core/${var.environment}/s3_extraction_bucket"
}

data "aws_ssm_parameter" "rds_host" {
  name = "/platform/core/${var.environment}/rds_host"
}

data "aws_ssm_parameters_by_path" "shared" {
  path            = "/platform/shared/"
  recursive       = false
  with_decryption = true
}

locals {
  name_prefix           = "${var.project_name}-${var.environment}"
  vpc_id                = var.vpc_id != "" ? var.vpc_id : data.aws_ssm_parameter.vpc_id.value
  subnet_ids            = var.subnet_ids != null ? var.subnet_ids : split(",", data.aws_ssm_parameter.subnet_ids.value)
  bucket_raw            = var.bucket_raw != "" ? var.bucket_raw : data.aws_ssm_parameter.s3_pdf_bucket.value
  bucket_processed      = var.bucket_processed != "" ? var.bucket_processed : data.aws_ssm_parameter.s3_extraction_bucket.value
  rds_host              = var.rds_host != "" ? var.rds_host : data.aws_ssm_parameter.rds_host.value
  shared_ssm_parameters = zipmap(data.aws_ssm_parameters_by_path.shared.names, data.aws_ssm_parameters_by_path.shared.values)
  database_url_from_ssm = lookup(local.shared_ssm_parameters, "/platform/shared/DATABASE_URL", "")
  database_url = var.database_url != "" ? var.database_url : (
    local.database_url_from_ssm != "" ? local.database_url_from_ssm : format(
      "postgresql://postgres:%s@%s:5432/postgres",
      urlencode(var.rds_password),
      local.rds_host
    )
  )
}

# S3 Module - Buckets and SQS Notification
module "s3" {
  source = "./modules/s3"

  project_name     = var.project_name
  environment      = var.environment
  bucket_raw       = local.bucket_raw
  bucket_processed = local.bucket_processed
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
  vpc_id              = local.vpc_id
  subnet_ids          = local.subnet_ids
  ecr_image_uri       = var.ecr_image_uri
  batch_vcpus         = var.batch_vcpus
  batch_memory        = var.batch_memory
  chunk_size          = var.chunk_size
  bucket_raw          = local.bucket_raw
  bucket_processed    = local.bucket_processed
  database_url        = local.database_url
  enable_job_tracking = true
  enable_inline_ocr   = var.enable_inline_ocr
  enable_ocr_queue    = var.enable_ocr_queue
  ocr_queue_url       = module.ocr_worker.ocr_queue_url
  ocr_queue_arn       = module.ocr_worker.ocr_queue_arn
  ocr_page_chunk_size = var.ocr_page_chunk_size

  depends_on = [module.dynamodb]
}

# OCR Worker Module - Async OCR queue + ECS/Fargate Spot service
module "ocr_worker" {
  source = "./modules/ocr_worker"

  project_name                      = var.project_name
  environment                       = var.environment
  name_prefix                       = local.name_prefix
  vpc_id                            = local.vpc_id
  subnet_ids                        = local.subnet_ids
  ecr_image_uri                     = var.ecr_image_uri
  bucket_raw                        = local.bucket_raw
  bucket_processed                  = local.bucket_processed
  ocr_worker_cpu                    = var.ocr_worker_cpu
  ocr_worker_memory                 = var.ocr_worker_memory
  ocr_max_tasks                     = var.ocr_max_tasks
  ocr_messages_per_task             = var.ocr_messages_per_task
  ocr_page_chunk_size               = var.ocr_page_chunk_size
  sqs_visibility_timeout_seconds    = var.ocr_queue_visibility_timeout_seconds
  sqs_receive_wait_seconds          = var.ocr_queue_receive_wait_seconds
  sqs_message_retention_seconds     = var.ocr_queue_message_retention_seconds
  sqs_max_receive_count             = var.ocr_dlq_max_receive_count
  log_retention_days                = var.ocr_worker_log_retention_days
  enable_alarms                     = var.enable_ocr_alarms
  queue_age_alarm_threshold_seconds = var.ocr_queue_age_alarm_threshold_seconds
  dlq_messages_alarm_threshold      = var.ocr_dlq_alarm_threshold
  alarm_sns_topic_arn               = var.ocr_alarm_sns_topic_arn
}

# Quickwit Module - Two-Node Cluster (Indexer + Searcher)
module "quickwit" {
  source = "./modules/quickwit"

  project_name            = var.project_name
  environment             = var.environment
  name_prefix             = local.name_prefix
  vpc_id                  = local.vpc_id
  subnet_id               = local.subnet_ids[0]
  indexer_instance_types  = var.quickwit_indexer_instance_types
  searcher_instance_types = var.quickwit_searcher_instance_types
  key_pair                = var.quickwit_key_pair
  quickwit_version        = var.quickwit_version
  rds_host                = local.rds_host
  rds_password            = var.rds_password
  bucket_raw              = local.bucket_raw
  bucket_processed        = local.bucket_processed
  sqs_queue_arn           = module.s3.sqs_queue_arn
  sqs_queue_url           = module.s3.sqs_queue_url
}
