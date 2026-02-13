# AsiaFilings Foundation Layer Variables

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
