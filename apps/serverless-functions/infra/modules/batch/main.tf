# AWS Batch Module — Fargate Spot compute for large download batches
#
# Used when the scraper discovers more filings than the Lambda Map state
# can handle efficiently. Step Functions routes to Batch via a size-based
# Choice state.

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID for Batch compute environment"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for Batch compute environment"
  type        = list(string)
}

variable "ecr_image_uri" {
  description = "ECR image URI for the batch download worker"
  type        = string
}

variable "chunk_size" {
  description = "Number of filings per Batch array job element"
  type        = number
  default     = 500
}

variable "batch_vcpus" {
  description = "vCPUs per Batch job"
  type        = number
  default     = 1
}

variable "batch_memory" {
  description = "Memory (MiB) per Batch job"
  type        = number
  default     = 2048
}

variable "s3_pdf_bucket" {
  description = "S3 bucket name for PDFs"
  type        = string
}

variable "s3_pdf_bucket_arn" {
  description = "S3 bucket ARN for PDFs"
  type        = string
}

variable "database_url" {
  description = "PostgreSQL connection string"
  type        = string
  sensitive   = true
}

variable "proxy_base_url" {
  description = "Optional FireProx proxy URL for IP rotation"
  type        = string
  default     = ""
}

# -----------------------------------------------------------------------------
# Security Group
# -----------------------------------------------------------------------------

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

# -----------------------------------------------------------------------------
# IAM — Batch Service Role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "batch_service" {
  name = "${var.name_prefix}-batch-service"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "batch.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "batch_service" {
  role       = aws_iam_role.batch_service.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSBatchServiceRole"
}

# -----------------------------------------------------------------------------
# IAM — ECS Task Execution Role
# -----------------------------------------------------------------------------

resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# -----------------------------------------------------------------------------
# IAM — Batch Job Role (task role for the container)
# -----------------------------------------------------------------------------

resource "aws_iam_role" "batch_job" {
  name = "${var.name_prefix}-batch-job"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

# S3 access — read manifests, write PDFs
resource "aws_iam_role_policy" "batch_job_s3" {
  name = "${var.name_prefix}-batch-job-s3"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:GetObject",
        "s3:PutObject"
      ]
      Resource = "${var.s3_pdf_bucket_arn}/*"
    }]
  })
}

# CloudWatch Logs
resource "aws_iam_role_policy" "batch_job_logs" {
  name = "${var.name_prefix}-batch-job-logs"
  role = aws_iam_role.batch_job.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "*"
    }]
  })
}

# -----------------------------------------------------------------------------
# Batch Compute Environment (Fargate Spot)
# -----------------------------------------------------------------------------

resource "aws_batch_compute_environment" "main" {
  compute_environment_name = "${var.name_prefix}-compute"
  type                     = "MANAGED"
  state                    = "ENABLED"
  service_role             = aws_iam_role.batch_service.arn

  compute_resources {
    type      = "FARGATE_SPOT"
    max_vcpus = 80

    subnets            = var.subnet_ids
    security_group_ids = [aws_security_group.batch.id]
  }

  depends_on = [aws_iam_role_policy_attachment.batch_service]
}

# -----------------------------------------------------------------------------
# Batch Job Queue
# -----------------------------------------------------------------------------

resource "aws_batch_job_queue" "main" {
  name     = "${var.name_prefix}-queue"
  state    = "ENABLED"
  priority = 1

  compute_environment_order {
    order               = 1
    compute_environment = aws_batch_compute_environment.main.arn
  }
}

# -----------------------------------------------------------------------------
# CloudWatch Log Group
# -----------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "batch" {
  name              = "/aws/batch/${var.name_prefix}"
  retention_in_days = 30
}

# -----------------------------------------------------------------------------
# Batch Job Definition
# -----------------------------------------------------------------------------

data "aws_region" "current" {}

resource "aws_batch_job_definition" "downloader" {
  name                  = "${var.name_prefix}-downloader"
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

    environment = [
      { name = "CHUNK_SIZE", value = tostring(var.chunk_size) },
      { name = "S3_BUCKET", value = var.s3_pdf_bucket },
      { name = "DATABASE_URL", value = var.database_url },
      { name = "PROXY_BASE_URL", value = var.proxy_base_url },
      { name = "LOG_LEVEL", value = "INFO" }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.batch.name
        "awslogs-region"        = data.aws_region.current.name
        "awslogs-stream-prefix" = "downloader"
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
    attempt_duration_seconds = 3600 # 1 hour
  }
}

# -----------------------------------------------------------------------------
# Outputs
# -----------------------------------------------------------------------------

output "job_queue_arn" {
  value = aws_batch_job_queue.main.arn
}

output "job_definition_arn" {
  value = aws_batch_job_definition.downloader.arn
}

output "compute_environment_arn" {
  value = aws_batch_compute_environment.main.arn
}
