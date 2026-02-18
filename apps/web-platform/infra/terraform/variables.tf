# =============================================================================
# Variables
# =============================================================================

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-east-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "prod"
}

# -----------------------------------------------------------------------------
# EC2
# -----------------------------------------------------------------------------

variable "ami_id" {
  description = "AMI ID for the EC2 instance"
  type        = string
  default     = "ami-09f19d92244d54afd"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t4g.medium"
}

variable "key_name" {
  description = "SSH key pair name"
  type        = string
  default     = "asiafilings-hk-key"
}

variable "subnet_id" {
  description = "Subnet ID for the EC2 instance (default VPC, ap-east-1c)"
  type        = string
  default     = "subnet-03d67a370e8fecf17"
}
