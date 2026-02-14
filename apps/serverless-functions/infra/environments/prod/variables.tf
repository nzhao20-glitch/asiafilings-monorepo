variable "aws_region" {
  description = "AWS region for deployment"
  type        = string
  default     = "ap-east-1" # Hong Kong region
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "hkex-downloader"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "pdf_bucket" {
  description = "S3 bucket for source PDFs (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "extraction_bucket" {
  description = "S3 bucket for extraction results (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "s3_prefix" {
  description = "S3 prefix for HKEX documents"
  type        = string
  default     = "hkex/"
}

variable "database_url" {
  description = "PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "vpc_id" {
  description = "VPC ID where RDS is running (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for Lambda (leave null to resolve from SSM)"
  type        = list(string)
  default     = null
}

variable "rds_security_group_id" {
  description = "Security group ID of the RDS instance (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "lambda_concurrency" {
  description = "Number of concurrent downloads per Lambda invocation (keep low to avoid rate limiting)"
  type        = number
  default     = 5
}

variable "lambda_memory" {
  description = "Lambda memory in MB"
  type        = number
  default     = 512
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 300 # 5 minutes
}

variable "sqs_batch_size" {
  description = "Number of SQS messages per Lambda invocation"
  type        = number
  default     = 1
}

variable "proxy_base_url" {
  description = "FireProx proxy URL (optional, leave empty to disable)"
  type        = string
  default     = ""
}

variable "lambda_security_group_id" {
  description = "Existing security group ID for Lambda (skip creating new one)"
  type        = string
  default     = ""
}

variable "lambda_in_vpc" {
  description = "Whether to run Lambda inside VPC (set to false for public RDS)"
  type        = bool
  default     = false
}

variable "max_concurrent_lambdas" {
  description = "Maximum concurrent Lambda executions (limits parallel downloads to avoid HKEX rate limiting). Set to -1 to use account default (no reservation). Note: AWS requires at least 10 unreserved in account."
  type        = number
  default     = -1
}
