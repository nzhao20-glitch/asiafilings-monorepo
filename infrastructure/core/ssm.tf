# =============================================================================
# SSM Parameter Store — Cross-stack resource sharing
# =============================================================================
# Consumer apps read these parameters to discover core infrastructure.
# Path convention: /platform/core/{env}/{key}

resource "aws_ssm_parameter" "vpc_id" {
  name  = "/platform/core/${var.environment}/vpc_id"
  type  = "String"
  value = aws_vpc.main.id
}

resource "aws_ssm_parameter" "subnet_ids" {
  name  = "/platform/core/${var.environment}/subnet_ids"
  type  = "StringList"
  value = join(",", aws_subnet.public[*].id)
}

resource "aws_ssm_parameter" "s3_pdf_bucket" {
  name  = "/platform/core/${var.environment}/s3_pdf_bucket"
  type  = "String"
  value = aws_s3_bucket.pdfs.bucket
}

resource "aws_ssm_parameter" "s3_pdf_bucket_arn" {
  name  = "/platform/core/${var.environment}/s3_pdf_bucket_arn"
  type  = "String"
  value = aws_s3_bucket.pdfs.arn
}

resource "aws_ssm_parameter" "s3_extraction_bucket" {
  name  = "/platform/core/${var.environment}/s3_extraction_bucket"
  type  = "String"
  value = aws_s3_bucket.extractions.bucket
}

resource "aws_ssm_parameter" "s3_extraction_bucket_arn" {
  name  = "/platform/core/${var.environment}/s3_extraction_bucket_arn"
  type  = "String"
  value = aws_s3_bucket.extractions.arn
}

resource "aws_ssm_parameter" "rds_endpoint" {
  name  = "/platform/core/${var.environment}/rds_endpoint"
  type  = "String"
  value = aws_db_instance.main.endpoint
}

resource "aws_ssm_parameter" "rds_host" {
  name  = "/platform/core/${var.environment}/rds_host"
  type  = "String"
  value = aws_db_instance.main.address
}

resource "aws_ssm_parameter" "rds_security_group_id" {
  name  = "/platform/core/${var.environment}/rds_security_group_id"
  type  = "String"
  value = aws_security_group.rds.id
}
