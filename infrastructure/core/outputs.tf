# =============================================================================
# Outputs — Mirror SSM parameters for direct Terraform consumption
# =============================================================================

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

output "s3_pdf_bucket" {
  description = "S3 bucket name for source PDFs"
  value       = aws_s3_bucket.pdfs.bucket
}

output "s3_pdf_bucket_arn" {
  description = "S3 bucket ARN for source PDFs"
  value       = aws_s3_bucket.pdfs.arn
}

output "s3_extraction_bucket" {
  description = "S3 bucket name for filing extractions"
  value       = aws_s3_bucket.extractions.bucket
}

output "s3_extraction_bucket_arn" {
  description = "S3 bucket ARN for filing extractions"
  value       = aws_s3_bucket.extractions.arn
}

output "rds_endpoint" {
  description = "RDS endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "rds_host" {
  description = "RDS hostname"
  value       = aws_db_instance.main.address
}

output "rds_security_group_id" {
  description = "RDS security group ID"
  value       = aws_security_group.rds.id
}
