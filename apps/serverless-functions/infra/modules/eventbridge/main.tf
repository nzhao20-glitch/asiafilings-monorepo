# EventBridge Rule for Daily HKEX Workflow Trigger
#
# Triggers the Step Functions state machine every day at 6 PM HKT (10 AM UTC).
# The input payload is empty so the scraper Lambda defaults to the last 24 hours.
#
# -----------------------------------------------------------------------
# Manual backfill via AWS CLI (bypasses EventBridge):
#
#   aws stepfunctions start-execution \
#     --state-machine-arn "<STATE_MACHINE_ARN>" \
#     --input '{"start_date":"2024-01-01","end_date":"2024-01-31","market":"SEHK"}'
# -----------------------------------------------------------------------

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "state_machine_arn" {
  description = "ARN of the Step Functions state machine to trigger"
  type        = string
}

variable "schedule_expression" {
  description = "Schedule expression for the rule (default: 6 PM HKT = 10 AM UTC)"
  type        = string
  default     = "cron(0 10 * * ? *)" # 10 AM UTC = 6 PM HKT (UTC+8)
}

variable "enabled" {
  description = "Whether the schedule is enabled"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# IAM Role for EventBridge to invoke Step Functions
resource "aws_iam_role" "eventbridge" {
  name = "${var.name_prefix}-eventbridge-sfn"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "events.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "eventbridge_sfn" {
  name = "${var.name_prefix}-start-execution"
  role = aws_iam_role.eventbridge.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "states:StartExecution"
      ]
      Resource = var.state_machine_arn
    }]
  })
}

# EventBridge Rule
resource "aws_cloudwatch_event_rule" "daily_workflow" {
  name                = "${var.name_prefix}-daily-schedule"
  description         = "Trigger HKEX scraping workflow daily at 6 PM HKT (10 AM UTC)"
  schedule_expression = var.schedule_expression
  state               = var.enabled ? "ENABLED" : "DISABLED"

  tags = var.tags
}

# EventBridge Target (Step Functions)
# Empty input object — the scraper Lambda defaults to querying the last 24 hours.
resource "aws_cloudwatch_event_target" "step_functions" {
  rule      = aws_cloudwatch_event_rule.daily_workflow.name
  target_id = "TriggerHKEXWorkflow"
  arn       = var.state_machine_arn
  role_arn  = aws_iam_role.eventbridge.arn

  input = jsonencode({})
}

output "rule_arn" {
  value = aws_cloudwatch_event_rule.daily_workflow.arn
}

output "rule_name" {
  value = aws_cloudwatch_event_rule.daily_workflow.name
}
