# =============================================================================
# PDF Extraction Lambda Infrastructure
# =============================================================================
# Python Lambda using PyMuPDF to extract text, tables, and images from PDFs.
# Optimized for high-throughput: async I/O with concurrent S3 operations,
# 3GB memory (~2 vCPUs), 15-min timeout, 50 PDFs per batch.
# 100 concurrent Lambda invocations = 5,000 PDFs in parallel.
# =============================================================================

# -----------------------------------------------------------------------------
# Variables for Extraction Lambda
# -----------------------------------------------------------------------------

variable "extraction_enabled" {
  description = "Enable extraction infrastructure"
  type        = bool
  default     = true
}

variable "extraction_lambda_memory" {
  description = "Extraction Lambda memory in MB (3008 = ~2 vCPUs)"
  type        = number
  default     = 3008
}

variable "extraction_lambda_timeout" {
  description = "Extraction Lambda timeout in seconds"
  type        = number
  default     = 900 # 15 minutes
}

variable "extraction_batch_size" {
  description = "Number of PDFs per extraction Lambda invocation"
  type        = number
  default     = 50
}

variable "extraction_max_workers" {
  description = "Number of parallel workers in Lambda (should match vCPUs)"
  type        = number
  default     = 2
}

variable "pymupdf_layer_arn" {
  description = "ARN of PyMuPDF Lambda layer (build with scripts/build_layer.sh)"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# S3 Buckets (use existing shared buckets from filing-etl-pipeline)
# -----------------------------------------------------------------------------
# Source PDFs: pdfs-128638789653/hkex/
# Extractions: filing-extractions-128638789653/processed/ and /tables/

# -----------------------------------------------------------------------------
# SQS Queue for Extraction Jobs
# -----------------------------------------------------------------------------

resource "aws_sqs_queue" "extraction_jobs" {
  count                      = var.extraction_enabled ? 1 : 0
  name                       = "${local.name_prefix}-extraction-jobs"
  visibility_timeout_seconds = var.extraction_lambda_timeout + 60 # 16 min
  message_retention_seconds  = 345600                             # 4 days
  receive_wait_time_seconds  = 20                                 # Long polling

  tags = local.common_tags
}

resource "aws_sqs_queue" "extraction_jobs_dlq" {
  count                     = var.extraction_enabled ? 1 : 0
  name                      = "${local.name_prefix}-extraction-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = local.common_tags
}

resource "aws_sqs_queue_redrive_policy" "extraction_jobs" {
  count     = var.extraction_enabled ? 1 : 0
  queue_url = aws_sqs_queue.extraction_jobs[0].id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.extraction_jobs_dlq[0].arn
    maxReceiveCount     = 3
  })
}

# -----------------------------------------------------------------------------
# IAM Role for Extraction Lambda
# -----------------------------------------------------------------------------

resource "aws_iam_role" "extraction_lambda" {
  count = var.extraction_enabled ? 1 : 0
  name  = "${local.name_prefix}-extraction-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "extraction_lambda_basic" {
  count      = var.extraction_enabled ? 1 : 0
  role       = aws_iam_role.extraction_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "extraction_lambda_vpc" {
  count      = var.extraction_enabled ? 1 : 0
  role       = aws_iam_role.extraction_lambda[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "extraction_lambda_custom" {
  count = var.extraction_enabled ? 1 : 0
  name  = "${local.name_prefix}-extraction-lambda-policy"
  role  = aws_iam_role.extraction_lambda[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "${data.aws_s3_bucket.pdfs.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${data.aws_s3_bucket.extractions.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.extraction_jobs[0].arn
      }
    ]
  })
}

# -----------------------------------------------------------------------------
# Extraction Lambda Function
# -----------------------------------------------------------------------------

resource "aws_lambda_function" "extractor" {
  count         = var.extraction_enabled ? 1 : 0
  function_name = "${local.name_prefix}-extractor"
  role          = aws_iam_role.extraction_lambda[0].arn
  handler       = "handler.handler"
  runtime       = "python3.11"
  architectures = ["arm64"]

  filename         = "${path.module}/extractor.zip"
  source_code_hash = fileexists("${path.module}/extractor.zip") ? filebase64sha256("${path.module}/extractor.zip") : null

  memory_size                    = var.extraction_lambda_memory
  timeout                        = var.extraction_lambda_timeout
  reserved_concurrent_executions = 100 # Match SQS maximum_concurrency

  # PyMuPDF + psycopg2 layer
  layers = var.pymupdf_layer_arn != "" ? [var.pymupdf_layer_arn] : []

  # VPC config only if lambda_in_vpc is true
  dynamic "vpc_config" {
    for_each = var.lambda_in_vpc ? [1] : []
    content {
      subnet_ids         = var.subnet_ids
      security_group_ids = [local.lambda_security_group_id]
    }
  }

  environment {
    variables = {
      DATABASE_URL      = var.database_url
      SOURCE_BUCKET     = data.aws_s3_bucket.pdfs.bucket
      SOURCE_PREFIX     = var.s3_prefix
      EXTRACTION_BUCKET = data.aws_s3_bucket.extractions.bucket
      OUTPUT_PREFIX     = "processed"
      TABLES_PREFIX     = "tables"
      MAX_WORKERS       = tostring(var.extraction_max_workers)
    }
  }

  tags = local.common_tags
}

# SQS trigger for Extraction Lambda
resource "aws_lambda_event_source_mapping" "extraction_sqs" {
  count            = var.extraction_enabled ? 1 : 0
  event_source_arn = aws_sqs_queue.extraction_jobs[0].arn
  function_name    = aws_lambda_function.extractor[0].arn
  batch_size       = 1 # One SQS message = 50 PDFs
  enabled          = true

  scaling_config {
    maximum_concurrency = 100 # Async I/O enables higher concurrency
  }
}

# CloudWatch Log Group for Extraction Lambda
resource "aws_cloudwatch_log_group" "extraction_lambda" {
  count             = var.extraction_enabled ? 1 : 0
  name              = "/aws/lambda/${aws_lambda_function.extractor[0].function_name}"
  retention_in_days = 14

  tags = local.common_tags
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "extraction_queue_url" {
  description = "SQS queue URL for extraction jobs"
  value       = var.extraction_enabled ? aws_sqs_queue.extraction_jobs[0].url : null
}

output "extraction_queue_arn" {
  description = "SQS queue ARN for extraction jobs"
  value       = var.extraction_enabled ? aws_sqs_queue.extraction_jobs[0].arn : null
}

output "extraction_dlq_url" {
  description = "Dead letter queue URL for extraction"
  value       = var.extraction_enabled ? aws_sqs_queue.extraction_jobs_dlq[0].url : null
}

output "extraction_bucket" {
  description = "S3 bucket for extraction results"
  value       = data.aws_s3_bucket.extractions.bucket
}

output "extraction_lambda_name" {
  description = "Extraction Lambda function name"
  value       = var.extraction_enabled ? aws_lambda_function.extractor[0].function_name : null
}
