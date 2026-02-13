# AsiaFilings Application Layer Variables

# General
variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "asiafilings"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "aws_region" {
  description = "AWS region for resources"
  type        = string
  default     = "ap-northeast-2" # Seoul
}

# Networking
variable "use_default_vpc" {
  description = "Use default VPC (set to false for custom VPC)"
  type        = bool
  default     = true
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS (optional)"
  type        = string
  default     = ""
}

# ECS Configuration
variable "container_port" {
  description = "Port the container listens on"
  type        = number
  default     = 3001
}

variable "ecs_task_cpu" {
  description = "CPU units for ECS task (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "ecs_task_memory" {
  description = "Memory for ECS task in MB"
  type        = number
  default     = 512
}

variable "ecs_desired_count" {
  description = "Desired number of ECS tasks"
  type        = number
  default     = 1
}

variable "ecs_min_count" {
  description = "Minimum number of ECS tasks for autoscaling"
  type        = number
  default     = 1
}

variable "ecs_max_count" {
  description = "Maximum number of ECS tasks for autoscaling"
  type        = number
  default     = 3
}

# Application Configuration
variable "log_level" {
  description = "Application log level"
  type        = string
  default     = "info"
}

variable "frontend_url" {
  description = "Frontend URL for CORS configuration"
  type        = string
  default     = "https://asiafilings.example.com"
}

variable "s3_bucket_name" {
  description = "S3 bucket name for document storage"
  type        = string
  default     = "asiafilings-documents-prod"
}

# Secrets ARNs (from AWS Secrets Manager)
# These can reference foundation layer outputs or be set manually

variable "database_url_secret_arn" {
  description = "ARN of DATABASE_URL secret in AWS Secrets Manager"
  type        = string
  default     = ""
}

variable "jwt_secret_arn" {
  description = "ARN of JWT_SECRET secret in AWS Secrets Manager"
  type        = string
  default     = ""
}

variable "jwt_refresh_secret_arn" {
  description = "ARN of JWT_REFRESH_SECRET secret in AWS Secrets Manager"
  type        = string
  default     = ""
}

variable "cookie_secret_arn" {
  description = "ARN of COOKIE_SECRET secret in AWS Secrets Manager"
  type        = string
  default     = ""
}
