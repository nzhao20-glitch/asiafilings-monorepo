output "sqs_queue_url" {
  description = "SQS queue URL for Quickwit ingestion"
  value       = module.s3.sqs_queue_url
}

output "sqs_queue_arn" {
  description = "SQS queue ARN"
  value       = module.s3.sqs_queue_arn
}

output "batch_job_queue_arn" {
  description = "AWS Batch job queue ARN"
  value       = module.batch.job_queue_arn
}

output "batch_job_definition_arn" {
  description = "AWS Batch job definition ARN"
  value       = module.batch.job_definition_arn
}

output "quickwit_searcher_public_ip" {
  description = "Quickwit searcher public IP (search API)"
  value       = module.quickwit.searcher_public_ip
}

output "quickwit_indexer_asg_name" {
  description = "Quickwit indexer ASG name"
  value       = module.quickwit.indexer_asg_name
}

output "quickwit_url" {
  description = "Quickwit search API URL"
  value       = "http://${module.quickwit.searcher_public_ip}:7280"
}

output "dynamodb_jobs_table" {
  description = "DynamoDB table for job tracking"
  value       = module.dynamodb.jobs_table_name
}

output "dynamodb_errors_table" {
  description = "DynamoDB table for error tracking"
  value       = module.dynamodb.errors_table_name
}

output "dynamodb_dedup_table" {
  description = "DynamoDB table for dedup tracking across pipelines"
  value       = module.dynamodb.dedup_table_name
}
