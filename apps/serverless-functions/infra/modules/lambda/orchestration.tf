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

variable "sqs_extraction_queue_url" {
  description = "SQS queue URL for extraction jobs"
  type        = string
}

variable "sns_topic_arn" {
  description = "SNS topic ARN for notifications"
  type        = string
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
  runtime       = "provided.al2"
  timeout       = 300 # 5 minutes
  memory_size   = 256

  filename         = "${path.module}/../../../services/scraper/cmd/scraper-lambda/scraper-lambda.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/scraper/cmd/scraper-lambda/scraper-lambda.zip")

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

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
  runtime       = "provided.al2"
  timeout       = 30
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/check-status/check-status.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/check-status/check-status.zip")

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

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
  runtime       = "provided.al2"
  timeout       = 60
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/download-trigger/download-trigger.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/download-trigger/download-trigger.zip")

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

  environment {
    variables = {
      DATABASE_URL  = var.database_url
      SQS_QUEUE_URL = var.sqs_download_queue_url
    }
  }

  tags = var.tags
}

# Extraction Trigger Lambda
resource "aws_lambda_function" "extraction_trigger" {
  function_name = "${var.name_prefix}-extraction-trigger"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2"
  timeout       = 60
  memory_size   = 128

  filename         = "${path.module}/../../../services/orchestrator/cmd/extraction-trigger/extraction-trigger.zip"
  source_code_hash = filebase64sha256("${path.module}/../../../services/orchestrator/cmd/extraction-trigger/extraction-trigger.zip")

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }

  environment {
    variables = {
      DATABASE_URL             = var.database_url
      SQS_EXTRACTION_QUEUE_URL = var.sqs_extraction_queue_url
    }
  }

  tags = var.tags
}

# Notify Lambda
resource "aws_lambda_function" "notify" {
  function_name = "${var.name_prefix}-notify"
  role          = aws_iam_role.orchestration.arn
  handler       = "bootstrap"
  runtime       = "provided.al2"
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

output "extraction_trigger_lambda_arn" {
  value = aws_lambda_function.extraction_trigger.arn
}

output "notify_lambda_arn" {
  value = aws_lambda_function.notify.arn
}
