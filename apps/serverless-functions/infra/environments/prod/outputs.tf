output "pdf_bucket" {
  description = "S3 bucket for source PDFs"
  value       = data.aws_s3_bucket.pdfs.bucket
}

output "extraction_bucket_name" {
  description = "S3 bucket for extraction results"
  value       = data.aws_s3_bucket.extractions.bucket
}

output "sqs_queue_url" {
  description = "URL of the SQS queue for download jobs"
  value       = aws_sqs_queue.download_jobs.url
}

output "sqs_queue_arn" {
  description = "ARN of the SQS queue"
  value       = aws_sqs_queue.download_jobs.arn
}

output "sqs_dlq_url" {
  description = "URL of the dead letter queue"
  value       = aws_sqs_queue.download_jobs_dlq.url
}

output "lambda_function_name" {
  description = "Name of the Lambda function"
  value       = aws_lambda_function.downloader.function_name
}

output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.downloader.arn
}

output "lambda_security_group_id" {
  description = "Security group ID of the Lambda function"
  value       = local.lambda_security_group_id
}
