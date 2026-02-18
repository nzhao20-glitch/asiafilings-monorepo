# OCR Worker Module - SQS queue + ECS Fargate Spot worker + autoscaling

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

variable "bucket_raw" {
  type = string
}

variable "bucket_processed" {
  type = string
}

variable "ocr_worker_cpu" {
  type    = number
  default = 1024
}

variable "ocr_worker_memory" {
  type    = number
  default = 2048
}

variable "ocr_max_tasks" {
  type    = number
  default = 128
}

variable "ocr_messages_per_task" {
  type    = number
  default = 1
}

variable "ocr_page_chunk_size" {
  type    = number
  default = 10
}

variable "sqs_visibility_timeout_seconds" {
  type    = number
  default = 1200
}

variable "sqs_receive_wait_seconds" {
  type    = number
  default = 20
}

variable "sqs_message_retention_seconds" {
  type    = number
  default = 1209600
}

variable "sqs_max_receive_count" {
  type    = number
  default = 5
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "enable_alarms" {
  type    = bool
  default = true
}

variable "alarm_sns_topic_arn" {
  type    = string
  default = ""
}

variable "queue_age_alarm_threshold_seconds" {
  type    = number
  default = 900
}

variable "dlq_messages_alarm_threshold" {
  type    = number
  default = 0
}

locals {
  alarm_actions = var.alarm_sns_topic_arn != "" ? [var.alarm_sns_topic_arn] : []
}

resource "aws_cloudwatch_log_group" "ocr_worker" {
  name              = "/aws/ecs/${var.name_prefix}-ocr-worker"
  retention_in_days = var.log_retention_days
}

resource "aws_sqs_queue" "ocr_dlq" {
  name                      = "${var.name_prefix}-ocr-dlq"
  message_retention_seconds = var.sqs_message_retention_seconds
}

resource "aws_sqs_queue" "ocr" {
  name                       = "${var.name_prefix}-ocr"
  message_retention_seconds  = var.sqs_message_retention_seconds
  visibility_timeout_seconds = var.sqs_visibility_timeout_seconds
  receive_wait_time_seconds  = var.sqs_receive_wait_seconds

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ocr_dlq.arn
    maxReceiveCount     = var.sqs_max_receive_count
  })
}

resource "aws_security_group" "ocr_worker" {
  name        = "${var.name_prefix}-ocr-worker"
  description = "Security group for OCR ECS worker"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name_prefix}-ocr"
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name = aws_ecs_cluster.main.name
  capacity_providers = [
    "FARGATE",
    "FARGATE_SPOT",
  ]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 0
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.name_prefix}-ocr-ecs-execution"

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

resource "aws_iam_role" "ocr_worker_task" {
  name = "${var.name_prefix}-ocr-task"

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

resource "aws_iam_role_policy" "ocr_worker_task" {
  name = "${var.name_prefix}-ocr-task-policy"
  role = aws_iam_role.ocr_worker_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility"
        ]
        Resource = [
          aws_sqs_queue.ocr.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_raw}",
          "arn:aws:s3:::${var.bucket_processed}"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_raw}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject"
        ]
        Resource = [
          "arn:aws:s3:::${var.bucket_processed}/ocr-bboxes/*",
          "arn:aws:s3:::${var.bucket_processed}/processed/*"
        ]
      }
    ]
  })
}

resource "aws_ecs_task_definition" "ocr_worker" {
  family                   = "${var.name_prefix}-ocr-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ocr_worker_cpu)
  memory                   = tostring(var.ocr_worker_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ocr_worker_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "ocr-worker"
      image     = var.ecr_image_uri
      essential = true
      entryPoint = ["python"]
      command    = ["ocr_worker.py"]
      environment = [
        { name = "LOG_LEVEL", value = "INFO" },
        { name = "OCR_QUEUE_URL", value = aws_sqs_queue.ocr.url },
        { name = "OCR_OUTPUT_BUCKET", value = var.bucket_processed },
        { name = "OUTPUT_PREFIX", value = "processed" },
        { name = "OCR_PAGE_CHUNK_SIZE", value = tostring(var.ocr_page_chunk_size) },
        { name = "OCR_QUEUE_WAIT_SECONDS", value = tostring(var.sqs_receive_wait_seconds) },
        { name = "OCR_QUEUE_VISIBILITY_TIMEOUT", value = tostring(var.sqs_visibility_timeout_seconds) }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ocr_worker.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "ocr_worker" {
  name            = "${var.name_prefix}-ocr-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.ocr_worker.arn
  desired_count   = 0

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 200

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
    base              = 0
  }

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [aws_security_group.ocr_worker.id]
    assign_public_ip = true
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.main,
    aws_iam_role_policy_attachment.ecs_task_execution,
    aws_cloudwatch_log_group.ocr_worker,
  ]
}

resource "aws_appautoscaling_target" "ocr_worker" {
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.ocr_worker.name}"
  min_capacity       = 0
  max_capacity       = var.ocr_max_tasks
}

resource "aws_appautoscaling_policy" "ocr_worker_queue_depth" {
  name               = "${var.name_prefix}-ocr-queue-depth"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.ocr_worker.service_namespace
  scalable_dimension = aws_appautoscaling_target.ocr_worker.scalable_dimension
  resource_id        = aws_appautoscaling_target.ocr_worker.resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = var.ocr_messages_per_task
    scale_out_cooldown = 30
    scale_in_cooldown  = 60

    customized_metric_specification {
      metric_name = "ApproximateNumberOfMessagesVisible"
      namespace   = "AWS/SQS"
      statistic   = "Average"

      dimensions {
        name  = "QueueName"
        value = aws_sqs_queue.ocr.name
      }
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "ocr_queue_age" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-ocr-queue-age"
  alarm_description   = "OCR queue age is above threshold"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateAgeOfOldestMessage"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.queue_age_alarm_threshold_seconds
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.ocr.name
  }
}

resource "aws_cloudwatch_metric_alarm" "ocr_dlq_messages" {
  count = var.enable_alarms ? 1 : 0

  alarm_name          = "${var.name_prefix}-ocr-dlq-messages"
  alarm_description   = "OCR DLQ contains failed messages"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.dlq_messages_alarm_threshold
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions

  dimensions = {
    QueueName = aws_sqs_queue.ocr_dlq.name
  }
}

data "aws_region" "current" {}

output "ocr_queue_url" {
  value = aws_sqs_queue.ocr.url
}

output "ocr_queue_arn" {
  value = aws_sqs_queue.ocr.arn
}

output "ocr_queue_name" {
  value = aws_sqs_queue.ocr.name
}

output "ocr_dlq_url" {
  value = aws_sqs_queue.ocr_dlq.url
}

output "ocr_dlq_arn" {
  value = aws_sqs_queue.ocr_dlq.arn
}

output "ocr_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "ocr_service_name" {
  value = aws_ecs_service.ocr_worker.name
}

output "ocr_queue_age_alarm_name" {
  value = try(aws_cloudwatch_metric_alarm.ocr_queue_age[0].alarm_name, "")
}

output "ocr_dlq_alarm_name" {
  value = try(aws_cloudwatch_metric_alarm.ocr_dlq_messages[0].alarm_name, "")
}
