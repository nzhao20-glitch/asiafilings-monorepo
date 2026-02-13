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
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Reference existing S3 buckets (shared with filing-etl-pipeline)
data "aws_s3_bucket" "pdfs" {
  bucket = var.pdf_bucket
}

data "aws_s3_bucket" "extractions" {
  bucket = var.extraction_bucket
}

# SQS Queue for download jobs
resource "aws_sqs_queue" "download_jobs" {
  name                       = "${local.name_prefix}-jobs"
  visibility_timeout_seconds = var.lambda_timeout + 30
  message_retention_seconds  = 345600 # 4 days
  receive_wait_time_seconds  = 20     # Long polling

  tags = local.common_tags
}

# Dead Letter Queue for failed messages
resource "aws_sqs_queue" "download_jobs_dlq" {
  name                      = "${local.name_prefix}-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = local.common_tags
}

resource "aws_sqs_queue_redrive_policy" "download_jobs" {
  queue_url = aws_sqs_queue.download_jobs.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.download_jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# Security Group for Lambda
# Use existing security group if provided, otherwise create new one
resource "aws_security_group" "lambda" {
  count       = var.lambda_security_group_id == "" ? 1 : 0
  name        = "${local.name_prefix}-lambda"
  description = "Security group for Lambda function"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

locals {
  lambda_security_group_id = var.lambda_security_group_id != "" ? var.lambda_security_group_id : aws_security_group.lambda[0].id
}

# Allow Lambda to connect to RDS (only if creating new SG)
resource "aws_security_group_rule" "lambda_to_rds" {
  count                    = var.lambda_security_group_id == "" ? 1 : 0
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = local.lambda_security_group_id
  security_group_id        = var.rds_security_group_id
  description              = "Allow Lambda to connect to RDS"
}
