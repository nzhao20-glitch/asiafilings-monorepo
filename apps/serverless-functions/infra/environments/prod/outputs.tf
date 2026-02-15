output "pdf_bucket" {
  description = "S3 bucket for source PDFs"
  value       = data.aws_s3_bucket.pdfs.bucket
  sensitive   = true
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

# -----------------------------------------------------------------------------
# Orchestration / Step Functions outputs
# -----------------------------------------------------------------------------

output "state_machine_arn" {
  description = "ARN of the Step Functions state machine (use with aws stepfunctions start-execution)"
  value       = module.step_functions.state_machine_arn
}

output "state_machine_name" {
  description = "Name of the Step Functions state machine"
  value       = module.step_functions.state_machine_name
}

output "eventbridge_rule_name" {
  description = "Name of the EventBridge daily schedule rule"
  value       = module.eventbridge.rule_name
}

output "scraper_lambda_arn" {
  description = "ARN of the scraper Lambda"
  value       = module.orchestration.scraper_lambda_arn
}

output "sfn_downloader_lambda_arn" {
  description = "ARN of the Step Functions downloader Lambda"
  value       = module.orchestration.sfn_downloader_lambda_arn
}

output "sns_topic_arn" {
  description = "ARN of the workflow notifications SNS topic"
  value       = aws_sns_topic.workflow_notifications.arn
}

# -----------------------------------------------------------------------------
# Batch outputs
# -----------------------------------------------------------------------------

output "batch_job_queue_arn" {
  description = "ARN of the Batch job queue for large downloads"
  value       = module.batch.job_queue_arn
}

output "batch_job_definition_arn" {
  description = "ARN of the Batch job definition"
  value       = module.batch.job_definition_arn
}

output "batch_compute_environment_arn" {
  description = "ARN of the Batch compute environment"
  value       = module.batch.compute_environment_arn
}
