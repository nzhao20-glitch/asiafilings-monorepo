# =============================================================================
# Core Infrastructure Variables
# =============================================================================

# --- General ---

variable "aws_region" {
  description = "AWS region for all core infrastructure"
  type        = string
  default     = "ap-east-1" # Hong Kong
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "prod"
}

# --- VPC ---

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"
}

# --- S3 ---

variable "s3_pdf_bucket" {
  description = "Name of the existing S3 bucket for source PDFs"
  type        = string
  default     = "pdfs-128638789653"
}

variable "s3_extraction_bucket" {
  description = "Name of the existing S3 bucket for filing extractions"
  type        = string
  default     = "filing-extractions-128638789653"
}

# --- RDS ---

variable "rds_instance_identifier" {
  description = "RDS instance identifier for import"
  type        = string
  default     = "asiafilings-db"
}

variable "rds_instance_class" {
  description = "RDS instance class (must match existing instance for import)"
  type        = string
  default     = "db.t4g.micro"
}

variable "rds_engine_version" {
  description = "PostgreSQL engine version (must match existing instance for import)"
  type        = string
  default     = "17.6"
}

variable "rds_allocated_storage" {
  description = "Allocated storage in GB (must match existing instance for import)"
  type        = number
  default     = 20
}

variable "rds_username" {
  description = "Master username"
  type        = string
  default     = "postgres"
}

variable "rds_password" {
  description = "Master password (leave empty to resolve from /platform/shared in SSM)"
  type        = string
  default     = ""
  sensitive   = true
}
