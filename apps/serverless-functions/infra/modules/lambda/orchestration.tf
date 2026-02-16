# Orchestration Lambda Functions

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Lambda functions"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for Lambda functions"
  type        = list(string)
}

variable "security_group_id" {
  description = "Security group ID for Lambda functions"
  type        = string
}

variable "database_url" {
  description = "PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "sqs_download_queue_url" {
  description = "SQS queue URL for download jobs"
  type        = string
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for notifications"
  type        = string
}

variable "s3_pdf_bucket_arn" {
  description = "ARN of the S3 PDFs bucket (for sfn-downloader permissions)"
  type        = string
}

variable "proxy_base_url" {
  description = "Optional FireProx proxy URL for IP rotation"
  type        = string
  default     = ""
}

variable "s3_pdf_bucket_name" {
  description = "Name of the S3 PDFs bucket"
  type        = string
}

variable "batch_chunk_size" {
  description = "Number of filings per Batch array job element"
  type        = number
  default     = 500
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# IAM Role for Orchestration Lambdas
resource "aws_iam_role" "orchestration" {
  name = "${var.name_prefix}-orchestration"

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

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "orchestration_vpc" {
  role       = aws_iam_role.orchestration.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "orchestration_sqs" {
  name = "${var.name_prefix}-sqs-access"
  role = aws_iam_role.orchestration.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:SendMessage",
        "sqs:SendMessageBatch"
      ]
      Resource = [
        "arn:aws:sqs:*:*:${var.name_prefix}*"
      ]
    }]
  })
}

resource "aws_iam_role_policy" "orchestration_sns" {
  name = "${var.name_prefix}-sns-access"
  role = aws_iam_role.orchestration.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sns:Publish"
      ]
      Resource = var.sns_topic_arn
    }]
  })
}

# Scraper Lambda
resource "aws_lambda_function" "scraper" {
  function_name = "${var.name_prefix}-scraper"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 300 # 5 minutes
  memory_size   = 256

  filename         = "${path.module}/../../../services/scraper/cmd/scraper-lambda/scraper-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/scraper/cmd/scraper-lambda/scraper-lambda.zip")

  environment {
    variables = {
      DATABASE_URL = var.database_url
    }
  }

  tags = var.tags
}

# Check Status Lambda
resource "aws_lambda_function" "check_status" {
  function_name = "${var.name_prefix}-check-status"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/check-status/check-status.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/check-status/check-status.zip")

  environment {
    variables = {
      DATABASE_URL = var.database_url
    }
  }

  tags = var.tags
}

# Download Trigger Lambda
resource "aws_lambda_function" "download_trigger" {
  function_name = "${var.name_prefix}-download-trigger"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/download-trigger/download-trigger.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/download-trigger/download-trigger.zip")

  environment {
    variables = {
      DATABASE_URL  = var.database_url
      SQS_QUEUE_URL = var.sqs_download_queue_url
    }
  }

  tags = var.tags
}

# Notify Lambda
resource "aws_lambda_function" "notify" {
  function_name = "${var.name_prefix}-notify"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/notify/notify.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/notify/notify.zip")

  environment {
    variables = {
      SNS_TOPIC_ARN = var.sns_topic_arn
    }
  }

  tags = var.tags
}

# ---------------------------------------------------------------
# Write Manifest Lambda
# Invoked by Step Functions before submitting a Batch array job.
# Writes the filing list as a JSON manifest to S3.
# ---------------------------------------------------------------

resource "aws_iam_role_policy" "orchestration_s3_put" {
  name = "${var.name_prefix}-orchestration-s3-put"
  role = aws_iam_role.orchestration.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject"
      ]
      Resource = "${var.s3_pdf_bucket_arn}/*"
    }]
  })
}

resource "aws_lambda_function" "write_manifest" {
  function_name = "${var.name_prefix}-write-manifest"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 60
  memory_size   = 256

  filename         = "${path.module}/../../../services/orchestrator/cmd/write-manifest/write-manifest.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/write-manifest/write-manifest.zip")

  environment {
    variables = {
      S3_BUCKET  = var.s3_pdf_bucket_name
      CHUNK_SIZE = tostring(var.batch_chunk_size)
    }
  }

  tags = var.tags
}

# ---------------------------------------------------------------
# Step Functions Downloader Lambda
# Invoked by the Map state — handles a single filing per execution.
# Has its own IAM role with S3 write permissions.
# ---------------------------------------------------------------

resource "aws_iam_role" "sfn_downloader" {
  name = "${var.name_prefix}-sfn-downloader"

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

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "sfn_downloader_basic" {
  role       = aws_iam_role.sfn_downloader.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "sfn_downloader_vpc" {
  role       = aws_iam_role.sfn_downloader.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "sfn_downloader_s3" {
  name = "${var.name_prefix}-sfn-downloader-s3"
  role = aws_iam_role.sfn_downloader.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ]
      Resource = "${var.s3_pdf_bucket_arn}/*"
    }]
  })
}

resource "aws_lambda_function" "sfn_downloader" {
  function_name = "${var.name_prefix}-sfn-downloader"
  role          = aws_iam_role.sfn_downloader.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 300 # 5 minutes per filing (includes retries + backoff)
  memory_size   = 256

  filename         = "${path.module}/../../../services/downloader/cmd/sfn-downloader/sfn-downloader.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/downloader/cmd/sfn-downloader/sfn-downloader.zip")

  environment {
    variables = {
      DATABASE_URL   = var.database_url
      S3_BUCKET      = var.s3_pdf_bucket_name
      PROXY_BASE_URL = var.proxy_base_url
    }
  }

  tags = var.tags
}

# ---------------------------------------------------------------
# Generate Chunks Lambda
# Invoked by Step Functions at the start of a backfill.
# Splits a date range into monthly chunks for sequential processing.
# ---------------------------------------------------------------

resource "aws_lambda_function" "generate_chunks" {
  function_name = "${var.name_prefix}-generate-chunks"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]
  timeout       = 30
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/generate-chunks/generate-chunks.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/generate-chunks/generate-chunks.zip")

  tags = var.tags
}

# Outputs
output "scraper_lambda_arn" {
  value = aws_lambda_function.scraper.arn
}

output "check_status_lambda_arn" {
  value = aws_lambda_function.check_status.arn
}

output "download_trigger_lambda_arn" {
  value = aws_lambda_function.download_trigger.arn
}

output "notify_lambda_arn" {
  value = aws_lambda_function.notify.arn
}

output "sfn_downloader_lambda_arn" {
  value = aws_lambda_function.sfn_downloader.arn
}

output "write_manifest_lambda_arn" {
  value = aws_lambda_function.write_manifest.arn
}

output "generate_chunks_lambda_arn" {
  value = aws_lambda_function.generate_chunks.arn
}
