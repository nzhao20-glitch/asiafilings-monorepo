# AWS Batch Module - Compute Environment, Job Queue, Job Definition

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "name_prefix" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "ecr_image_uri" {
  type = string
}

variable "batch_vcpus" {
  type    = number
  default = 1
}

variable "batch_memory" {
  type    = number
  default = 2048
}

variable "chunk_size" {
  type    = number
  default = 1000
}

variable "bucket_raw" {
  type = string
}

variable "bucket_processed" {
  type = string
}

variable "enable_job_tracking" {
  type    = bool
  default = false
}

variable "database_url" {
  type = string
}

variable "enable_inline_ocr" {
  type    = bool
  default = false
}

variable "enable_ocr_queue" {
  type    = bool
  default = true
}

variable "ocr_queue_url" {
  type    = string
  default = ""
}

variable "ocr_queue_arn" {
  type    = string
  default = ""
}

variable "ocr_page_chunk_size" {
  type    = number
  default = 10
}

# Security Group for Batch Jobs
resource "aws_security_group" "batch" {
  name        = "${var.name_prefix}-batch"
  description = "Security group for Batch compute environment"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM Role for Batch Service
resource "aws_iam_role" "batch_service" {
  name = "${var.name_prefix}-batch-service"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "batch.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "batch_service" {
  role       = aws_iam_role.batch_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole"
}

# IAM Role for ECS Task Execution
resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# IAM Role for Batch Job (Task Role)
resource "aws_iam_role" "batch_job" {
  name = "${var.name_prefix}-batch-job"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

# S3 Access Policy for Batch Job
resource "aws_iam_role_policy" "batch_job_s3" {
  name = "${var.name_prefix}-batch-job-s3"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_raw}",
          "arn:aws:s3:::${var.bucket_raw}/*",
          "arn:aws:s3:::${var.bucket_processed}",
          "arn:aws:s3:::${var.bucket_processed}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_processed}/*"
        ]
      }
    ]
  })
}

# CloudWatch Logs + Metrics Policy for Batch Job
resource "aws_iam_role_policy" "batch_job_logs" {
  name = "${var.name_prefix}-batch-job-logs"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      }
    ]
  })
}

# DynamoDB Policy for Batch Job (job tracking)
resource "aws_iam_role_policy" "batch_job_dynamodb" {
  name = "${var.name_prefix}-batch-job-dynamodb"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem"
        ]
        Resource = [
          "arn:aws:dynamodb:*:*:table/${var.name_prefix}-jobs",
          "arn:aws:dynamodb:*:*:table/${var.name_prefix}-errors",
          "arn:aws:dynamodb:*:*:table/${var.name_prefix}-dedup"
        ]
      }
    ]
  })
}

# SQS Policy for Batch Job (OCR queue publishing)
resource "aws_iam_role_policy" "batch_job_ocr_queue" {
  count = var.enable_ocr_queue ? 1 : 0

  name = "${var.name_prefix}-batch-job-ocr-queue"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:SendMessage"
        ]
        Resource = [
          var.ocr_queue_arn
        ]
      }
    ]
  })
}

# Batch Compute Environment (Fargate Spot for cost savings)
resource "aws_batch_compute_environment" "main" {
  compute_environment_name = "${var.name_prefix}-compute"
  type                     = "MANAGED"
  state                    = "ENABLED"
  service_role             = aws_iam_role.batch_service.arn

  compute_resources {
    type      = "FARGATE_SPOT"
    max_vcpus = 256

    subnets            = var.subnet_ids
    security_group_ids = [aws_security_group.batch.id]
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]
}

# Batch Job Queue
resource "aws_batch_job_queue" "main" {
  name     = "${var.name_prefix}-queue"
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.main.arn
  }
}

# CloudWatch Log Group for Batch Jobs
resource "aws_cloudwatch_log_group" "batch" {
  name              = "/aws/batch/${var.name_prefix}"
  retention_in_days = 30
}

# Batch Job Definition
resource "aws_batch_job_definition" "etl_worker" {
  name                  = "${var.name_prefix}-etl-worker"
  type                  = "container"
  platform_capabilities = ["FARGATE"]

  container_properties = jsonencode({
    image = var.ecr_image_uri

    fargatePlatformConfiguration = {
      platformVersion = "LATEST"
    }

    runtimePlatform = {
      cpuArchitecture       = "ARM64"
      operatingSystemFamily = "LINUX"
    }

    resourceRequirements = [
      { type = "VCPU", value = tostring(var.batch_vcpus) },
      { type = "MEMORY", value = tostring(var.batch_memory) }
    ]

    executionRoleArn = aws_iam_role.ecs_task_execution.arn
    jobRoleArn       = aws_iam_role.batch_job.arn

    environment = concat([
      { name = "CHUNK_SIZE", value = tostring(var.chunk_size) },
      { name = "OUTPUT_BUCKET", value = var.bucket_processed },
      { name = "OUTPUT_PREFIX", value = "processed" },
      { name = "DATABASE_URL", value = var.database_url },
      { name = "ENABLE_INLINE_OCR", value = tostring(var.enable_inline_ocr) },
      { name = "ENABLE_OCR_QUEUE", value = tostring(var.enable_ocr_queue) },
      { name = "OCR_QUEUE_URL", value = var.ocr_queue_url },
      { name = "OCR_PAGE_CHUNK_SIZE", value = tostring(var.ocr_page_chunk_size) },
      { name = "LOG_LEVEL", value = "INFO" }
      ], var.enable_job_tracking ? [
      { name = "ENABLE_JOB_TRACKING", value = "true" },
      { name = "DYNAMODB_JOBS_TABLE", value = "${var.name_prefix}-jobs" },
      { name = "DYNAMODB_ERRORS_TABLE", value = "${var.name_prefix}-errors" },
      { name = "ENABLE_DEDUP", value = "true" },
      { name = "DYNAMODB_DEDUP_TABLE", value = "${var.name_prefix}-dedup" }
    ] : [])

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "etl"
      }
    }

    networkConfiguration = {
      assignPublicIp = "ENABLED"
    }
  })

  retry_strategy {
    attempts = 2
  }

  timeout {
    attempt_duration_seconds = 3600 # 1 hour max per job
  }
}

data "aws_region" "current" {}

# Outputs
output "job_queue_arn" {
  value = aws_batch_job_queue.main.arn
}

output "job_queue_name" {
  value = aws_batch_job_queue.main.name
}

output "job_definition_arn" {
  value = aws_batch_job_definition.etl_worker.arn
}

output "job_definition_name" {
  value = aws_batch_job_definition.etl_worker.name
}

output "compute_environment_arn" {
  value = aws_batch_compute_environment.main.arn
}
