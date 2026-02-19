# =============================================================================
# Orchestration Layer — Step Functions Workflow
# =============================================================================
# Wires together the orchestration Lambdas, Step Functions state machine,
# and EventBridge daily schedule.
# =============================================================================

# -----------------------------------------------------------------------------
# SNS Topic for workflow notifications
# -----------------------------------------------------------------------------

resource "aws_sns_topic" "workflow_notifications" {
  name = "${local.name_prefix}-workflow-notifications"
  tags = local.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.notification_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.workflow_notifications.arn
  protocol  = "email"
  endpoint  = var.notification_email
}

# -----------------------------------------------------------------------------
# Module: Orchestration Lambdas
# (scraper, check-status, download-trigger, notify, sfn-downloader,
#  write-manifest)
# -----------------------------------------------------------------------------

module "orchestration" {
  source = "../../modules/lambda"

  name_prefix            = local.name_prefix
  vpc_id                 = local.vpc_id
  subnet_ids             = local.subnet_ids
  security_group_id      = local.lambda_security_group_id
  database_url           = local.database_url
  sqs_download_queue_url = aws_sqs_queue.download_jobs.url
  sns_topic_arn          = aws_sns_topic.workflow_notifications.arn
  s3_pdf_bucket_arn      = data.aws_s3_bucket.pdfs.arn
  s3_pdf_bucket_name     = data.aws_s3_bucket.pdfs.bucket
  proxy_base_url         = var.proxy_base_url
  batch_chunk_size       = var.batch_chunk_size
  tags                   = local.common_tags
}

# -----------------------------------------------------------------------------
# Module: AWS Batch — Fargate Spot for large download batches
# -----------------------------------------------------------------------------

module "batch" {
  source = "../../modules/batch"

  name_prefix       = local.name_prefix
  vpc_id            = local.vpc_id
  subnet_ids        = local.subnet_ids
  ecr_image_uri     = local.batch_ecr_image_uri
  chunk_size        = var.batch_chunk_size
  s3_pdf_bucket     = data.aws_s3_bucket.pdfs.bucket
  s3_pdf_bucket_arn = data.aws_s3_bucket.pdfs.arn
  database_url      = local.database_url
  proxy_base_url    = var.proxy_base_url
}

# -----------------------------------------------------------------------------
# Module: Step Functions State Machine
# Scrape → CheckNewFilings → RouteBySize →
#   Small: Map(Download) → TriggerExtractions → Notify
#   Large: WriteManifest → BatchDownload → TriggerExtractions → Notify
# -----------------------------------------------------------------------------

module "step_functions" {
  source = "../../modules/step-functions"

  name_prefix                = local.name_prefix
  scraper_lambda_arn         = module.orchestration.scraper_lambda_arn
  sfn_downloader_lambda_arn  = module.orchestration.sfn_downloader_lambda_arn
  notify_lambda_arn          = module.orchestration.notify_lambda_arn
  write_manifest_lambda_arn  = module.orchestration.write_manifest_lambda_arn
  batch_job_queue_arn        = module.batch.job_queue_arn
  batch_job_definition_arn   = module.batch.job_definition_arn
  generate_chunks_lambda_arn = module.orchestration.generate_chunks_lambda_arn
  batch_filing_threshold     = var.batch_filing_threshold
  download_max_concurrency   = var.download_max_concurrency
  tags                       = local.common_tags
}

# -----------------------------------------------------------------------------
# Module: EventBridge — daily trigger at 6 PM HKT (10 AM UTC)
# -----------------------------------------------------------------------------

module "eventbridge" {
  source = "../../modules/eventbridge"

  name_prefix       = local.name_prefix
  state_machine_arn = module.step_functions.state_machine_arn
  enabled           = var.schedule_enabled
  tags              = local.common_tags
}
