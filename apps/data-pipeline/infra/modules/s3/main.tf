# S3 Module - Buckets and SQS Notification for Quickwit

variable "project_name" {
  type = string
}

variable "environment" {
  type = string
}

variable "bucket_raw" {
  type = string
}

variable "bucket_processed" {
  type = string
}

variable "create_buckets" {
  type    = bool
  default = false
}

# Create extraction bucket if requested (raw bucket already exists)
resource "aws_s3_bucket" "processed" {
  count  = var.create_buckets ? 1 : 0
  bucket = var.bucket_processed
}

# Enable versioning on extraction bucket
resource "aws_s3_bucket_versioning" "processed" {
  count  = var.create_buckets ? 1 : 0
  bucket = aws_s3_bucket.processed[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

# Lifecycle policy - transition old extractions to cheaper storage
resource "aws_s3_bucket_lifecycle_configuration" "processed" {
  count  = var.create_buckets ? 1 : 0
  bucket = aws_s3_bucket.processed[0].id

  rule {
    id     = "transition-old-extractions"
    status = "Enabled"

    filter {
      prefix = ""
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 365
      storage_class = "GLACIER"
    }
  }
}

# Data source to reference processed bucket (works for both created and existing)
data "aws_s3_bucket" "processed" {
  bucket     = var.bucket_processed
  depends_on = [aws_s3_bucket.processed]
}

# SQS Queue for Quickwit ingestion notifications
resource "aws_sqs_queue" "quickwit_ingest" {
  name                       = "${var.project_name}-${var.environment}-quickwit-ingest"
  message_retention_seconds  = 1209600 # 14 days
  visibility_timeout_seconds = 300     # 5 minutes
  receive_wait_time_seconds  = 20      # Long polling

  # Dead letter queue for failed messages
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.quickwit_ingest_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue" "quickwit_ingest_dlq" {
  name                      = "${var.project_name}-${var.environment}-quickwit-ingest-dlq"
  message_retention_seconds = 1209600 # 14 days
}

# SQS Queue Policy - Allow S3 to send notifications
resource "aws_sqs_queue_policy" "quickwit_ingest" {
  queue_url = aws_sqs_queue.quickwit_ingest.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Service = "s3.amazonaws.com" }
        Action    = "sqs:SendMessage"
        Resource  = aws_sqs_queue.quickwit_ingest.arn
        Condition = {
          ArnLike = {
            "aws:SourceArn" = "arn:aws:s3:::${var.bucket_processed}"
          }
        }
      }
    ]
  })
}

# S3 Bucket Notification - Send events to SQS when JSONL files are created
resource "aws_s3_bucket_notification" "processed" {
  bucket = data.aws_s3_bucket.processed.id

  queue {
    queue_arn     = aws_sqs_queue.quickwit_ingest.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "processed/"
    filter_suffix = ".jsonl"
  }

  depends_on = [aws_sqs_queue_policy.quickwit_ingest]
}

# Outputs
output "sqs_queue_url" {
  value = aws_sqs_queue.quickwit_ingest.url
}

output "sqs_queue_arn" {
  value = aws_sqs_queue.quickwit_ingest.arn
}

output "sqs_dlq_url" {
  value = aws_sqs_queue.quickwit_ingest_dlq.url
}
