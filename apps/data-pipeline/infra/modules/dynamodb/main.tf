# DynamoDB Module - Job tracking tables

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type = string
}

# Jobs table - tracks ETL job execution
resource "aws_dynamodb_table" "jobs" {
  name         = "${var.name_prefix}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"

  attribute {
    name = "job_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# Errors table - tracks individual file errors
resource "aws_dynamodb_table" "errors" {
  name         = "${var.name_prefix}-errors"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"
  range_key    = "s3_key"

  attribute {
    name = "job_id"
    type = "S"
  }

  attribute {
    name = "s3_key"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# Dedup table - tracks processed items across pipelines
# pk = "{exchange}#{job_type}" (e.g. "HKEX#extraction"), sk = source_id
resource "aws_dynamodb_table" "dedup" {
  name         = "${var.name_prefix}-dedup"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "source_id"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "source_id"
    type = "S"
  }

  # No TTL — records persist permanently for dedup

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

# Outputs
output "jobs_table_name" {
  value = aws_dynamodb_table.jobs.name
}

output "jobs_table_arn" {
  value = aws_dynamodb_table.jobs.arn
}

output "errors_table_name" {
  value = aws_dynamodb_table.errors.name
}

output "errors_table_arn" {
  value = aws_dynamodb_table.errors.arn
}

output "dedup_table_name" {
  value = aws_dynamodb_table.dedup.name
}

output "dedup_table_arn" {
  value = aws_dynamodb_table.dedup.arn
}
