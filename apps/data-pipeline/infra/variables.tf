variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "filing-etl"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-east-1"
}

# S3 Configuration
variable "bucket_raw" {
  description = "S3 bucket for source PDF files (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "bucket_processed" {
  description = "S3 bucket for processed JSONL output (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "create_buckets" {
  description = "Whether to create S3 buckets (false if using existing)"
  type        = bool
  default     = false
}

# Batch Configuration
variable "batch_vcpus" {
  description = "vCPUs for batch job"
  type        = number
  default     = 1
}

variable "batch_memory" {
  description = "Memory (MB) for batch job"
  type        = number
  default     = 2048
}

variable "ecr_image_uri" {
  description = "ECR image URI for the ETL worker"
  type        = string
}

variable "chunk_size" {
  description = "Number of files per batch job"
  type        = number
  default     = 1000
}

variable "enable_inline_ocr" {
  description = "Enable inline OCR fallback inside ETL extraction path"
  type        = bool
  default     = false
}

variable "enable_ocr_queue" {
  description = "Enable OCR queue publishing from ETL jobs"
  type        = bool
  default     = true
}

variable "ocr_page_chunk_size" {
  description = "Broken pages per OCR queue message"
  type        = number
  default     = 10
}

variable "ocr_worker_cpu" {
  description = "CPU units for OCR ECS tasks"
  type        = number
  default     = 1024
}

variable "ocr_worker_memory" {
  description = "Memory (MB) for OCR ECS tasks"
  type        = number
  default     = 2048
}

variable "ocr_max_tasks" {
  description = "Maximum OCR ECS tasks for autoscaling"
  type        = number
  default     = 128
}

variable "ocr_messages_per_task" {
  description = "Target visible SQS messages per running OCR task"
  type        = number
  default     = 1
}

variable "ocr_queue_visibility_timeout_seconds" {
  description = "OCR SQS queue visibility timeout in seconds"
  type        = number
  default     = 1200
}

variable "ocr_queue_receive_wait_seconds" {
  description = "OCR SQS long poll wait time in seconds"
  type        = number
  default     = 20
}

variable "ocr_queue_message_retention_seconds" {
  description = "OCR SQS message retention in seconds"
  type        = number
  default     = 1209600
}

variable "ocr_dlq_max_receive_count" {
  description = "Max receives before moving OCR message to DLQ"
  type        = number
  default     = 5
}

variable "ocr_worker_log_retention_days" {
  description = "CloudWatch log retention for OCR worker logs"
  type        = number
  default     = 30
}

variable "enable_ocr_alarms" {
  description = "Create CloudWatch alarms for OCR queue age and DLQ depth"
  type        = bool
  default     = true
}

variable "ocr_queue_age_alarm_threshold_seconds" {
  description = "Alarm threshold for OCR queue oldest message age"
  type        = number
  default     = 900
}

variable "ocr_dlq_alarm_threshold" {
  description = "Alarm threshold for OCR DLQ visible messages"
  type        = number
  default     = 0
}

variable "ocr_alarm_sns_topic_arn" {
  description = "Optional SNS topic ARN for OCR alarms"
  type        = string
  default     = ""
}

# Quickwit Configuration
variable "quickwit_indexer_instance_types" {
  description = "EC2 instance types for Quickwit indexer node (ordered by preference)"
  type        = list(string)
  default     = ["t4g.medium", "t4g.large", "m6g.medium", "m7g.medium"]
}

variable "quickwit_searcher_instance_types" {
  description = "EC2 instance types for Quickwit searcher node (ordered by preference, must have local NVMe)"
  type        = list(string)
  default     = ["r7gd.xlarge", "m6gd.xlarge"]
}

variable "rds_host" {
  description = "RDS PostgreSQL hostname for Quickwit metastore (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "rds_password" {
  description = "RDS PostgreSQL password for Quickwit metastore"
  type        = string
  sensitive   = true
}

variable "database_url" {
  description = "PostgreSQL connection URL for ETL worker (leave empty for SSM/fallback construction)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "quickwit_key_pair" {
  description = "SSH key pair name for Quickwit EC2"
  type        = string
  default     = ""
}

variable "quickwit_version" {
  description = "Quickwit version to install"
  type        = string
  default     = "0.8.1"
}

variable "vpc_id" {
  description = "VPC ID for resources (leave empty to resolve from SSM)"
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for resources (leave null to resolve from SSM)"
  type        = list(string)
  default     = null
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default     = {}
}
