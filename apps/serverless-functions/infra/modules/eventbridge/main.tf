# EventBridge Rule for Daily HKEX Workflow Trigger

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "state_machine_arn" {
  description = "ARN of the Step Functions state machine to trigger"
  type        = string
}

variable "schedule_expression" {
  description = "Schedule expression for the rule (default: 9 AM HKT = 1 AM UTC)"
  type        = string
  default     = "cron(0 1 * * ? *)" # 1 AM UTC = 9 AM HKT
}

variable "enabled" {
  description = "Whether the schedule is enabled"
  type        = bool
  default     = true
}

variable "max_pages" {
  description = "Max pages to scrape (passed to state machine)"
  type        = number
  default     = 10
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
  description         = "Trigger HKEX scraping workflow daily at 9 AM HKT"
  schedule_expression = var.schedule_expression
  state               = var.enabled ? "ENABLED" : "DISABLED"

  tags = var.tags
}

# EventBridge Target (Step Functions)
resource "aws_cloudwatch_event_target" "step_functions" {
  rule      = aws_cloudwatch_event_rule.daily_workflow.name
  target_id = "TriggerHKEXWorkflow"
  arn       = var.state_machine_arn
  role_arn  = aws_iam_role.eventbridge.arn

  input = jsonencode({
    max_pages = var.max_pages
    waitCount = 0 # Initialize wait counter for polling loop
  })
}

output "rule_arn" {
  value = aws_cloudwatch_event_rule.daily_workflow.arn
}

output "rule_name" {
  value = aws_cloudwatch_event_rule.daily_workflow.name
}
