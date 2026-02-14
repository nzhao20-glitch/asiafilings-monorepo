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
