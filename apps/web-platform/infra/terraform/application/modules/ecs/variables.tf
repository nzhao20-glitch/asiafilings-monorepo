# ECS Module Variables

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

# Networking
variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnets" {
  description = "List of private subnet IDs for ECS tasks"
  type        = list(string)
}

variable "ecs_security_groups" {
  description = "List of security group IDs for ECS tasks"
  type        = list(string)
}

# Load Balancer
variable "alb_target_group_arn" {
  description = "ARN of the ALB target group"
  type        = string
}

# Container
variable "ecr_repository_url" {
  description = "URL of the ECR repository"
  type        = string
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
}

# Resources
variable "cpu" {
  description = "CPU units for the task"
  type        = number
}

variable "memory" {
  description = "Memory (MB) for the task"
  type        = number
}

# Scaling
variable "desired_count" {
  description = "Desired number of tasks"
  type        = number
}

variable "min_count" {
  description = "Minimum number of tasks"
  type        = number
}

variable "max_count" {
  description = "Maximum number of tasks"
  type        = number
}

# Application Configuration
variable "environment_variables" {
  description = "Map of environment variables for the container"
  type        = map(string)
  default     = {}
}

variable "secrets" {
  description = "Map of secrets (name -> ARN)"
  type        = map(string)
  default     = {}
}
