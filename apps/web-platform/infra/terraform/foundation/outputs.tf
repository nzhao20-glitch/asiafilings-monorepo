# AsiaFilings Foundation Layer Outputs
# These outputs are used by the application layer via terraform_remote_state

output "aws_region" {
  description = "AWS region"
  value       = var.aws_region
}

output "project_name" {
  description = "Project name"
  value       = var.project_name
}

output "environment" {
  description = "Environment name"
  value       = var.environment
}

# State backend outputs (for bootstrapping)
output "terraform_state_bucket" {
  description = "S3 bucket for Terraform state"
  value       = module.state_backend.state_bucket_name
}

output "terraform_lock_table" {
  description = "DynamoDB table for state locking"
  value       = module.state_backend.lock_table_name
}

# S3 document storage outputs
output "documents_bucket" {
  description = "S3 bucket for document storage"
  value       = module.s3.bucket_name
}

output "documents_bucket_arn" {
  description = "ARN of document storage bucket"
  value       = module.s3.bucket_arn
}

# Secrets ARNs for ECS task definitions
output "database_url_secret_arn" {
  description = "ARN of DATABASE_URL secret"
  value       = module.secrets.secret_arns["database_url"]
  sensitive   = true
}

output "jwt_secret_arn" {
  description = "ARN of JWT_SECRET secret"
  value       = module.secrets.secret_arns["jwt_secret"]
  sensitive   = true
}

output "jwt_refresh_secret_arn" {
  description = "ARN of JWT_REFRESH_SECRET secret"
  value       = module.secrets.secret_arns["jwt_refresh_secret"]
  sensitive   = true
}

output "cookie_secret_arn" {
  description = "ARN of COOKIE_SECRET secret"
  value       = module.secrets.secret_arns["cookie_secret"]
  sensitive   = true
}
