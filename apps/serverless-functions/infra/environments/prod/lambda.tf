# IAM Role for Lambda
resource "aws_iam_role" "lambda" {
  name = "${local.name_prefix}-lambda-role"

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

# Lambda basic execution policy (CloudWatch logs)
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Lambda VPC execution policy (only if using VPC)
resource "aws_iam_role_policy_attachment" "lambda_vpc" {
  count      = var.lambda_in_vpc ? 1 : 0
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Custom policy for S3 and SQS access
resource "aws_iam_role_policy" "lambda_custom" {
  name = "${local.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${data.aws_s3_bucket.pdfs.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes"
        ]
        Resource = aws_sqs_queue.download_jobs.arn
      }
    ]
  })
}

# Lambda function
resource "aws_lambda_function" "downloader" {
  function_name = local.name_prefix
  role          = aws_iam_role.lambda.arn
  handler       = "bootstrap"
  runtime       = "provided.al2023"
  architectures = ["arm64"]

  filename         = "${path.module}/function.zip"
  source_code_hash = filebase64sha256("${path.module}/function.zip")

  memory_size = var.lambda_memory
  timeout     = var.lambda_timeout

  # Limit concurrent executions to avoid HKEX rate limiting
  reserved_concurrent_executions = var.max_concurrent_lambdas

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
      DATABASE_URL   = var.database_url
      S3_BUCKET      = data.aws_s3_bucket.pdfs.bucket
      S3_PREFIX      = var.s3_prefix
      CONCURRENCY    = tostring(var.lambda_concurrency)
      PROXY_BASE_URL = var.proxy_base_url
    }
  }

  tags = local.common_tags
}

# SQS trigger for Lambda
resource "aws_lambda_event_source_mapping" "sqs" {
  event_source_arn = aws_sqs_queue.download_jobs.arn
  function_name    = aws_lambda_function.downloader.arn
  batch_size       = var.sqs_batch_size
  enabled          = true

  scaling_config {
    maximum_concurrency = 25 # Limit concurrent Lambdas to protect RDS
  }
}

# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${aws_lambda_function.downloader.function_name}"
  retention_in_days = 14

  tags = local.common_tags
}
