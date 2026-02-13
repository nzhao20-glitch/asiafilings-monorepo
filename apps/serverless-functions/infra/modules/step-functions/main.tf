# Step Functions State Machine for HKEX Daily Workflow

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "scraper_lambda_arn" {
  description = "ARN of the scraper Lambda"
  type        = string
}

variable "check_status_lambda_arn" {
  description = "ARN of the check-status Lambda"
  type        = string
}

variable "download_trigger_lambda_arn" {
  description = "ARN of the download-trigger Lambda"
  type        = string
}

variable "extraction_trigger_lambda_arn" {
  description = "ARN of the extraction-trigger Lambda"
  type        = string
}

variable "notify_lambda_arn" {
  description = "ARN of the notify Lambda"
  type        = string
}

variable "tags" {
  description = "Tags to apply to resources"
  type        = map(string)
  default     = {}
}

# IAM Role for Step Functions
resource "aws_iam_role" "step_functions" {
  name = "${var.name_prefix}-step-functions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "states.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "step_functions_lambda" {
  name = "${var.name_prefix}-invoke-lambda"
  role = aws_iam_role.step_functions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "lambda:InvokeFunction"
      ]
      Resource = [
        var.scraper_lambda_arn,
        var.check_status_lambda_arn,
        var.download_trigger_lambda_arn,
        var.extraction_trigger_lambda_arn,
        var.notify_lambda_arn
      ]
    }]
  })
}

# State Machine Definition
resource "aws_sfn_state_machine" "hkex_workflow" {
  name     = "${var.name_prefix}-daily-workflow"
  role_arn = aws_iam_role.step_functions.arn

  definition = jsonencode({
    Comment = "HKEX Daily Scraping and Processing Workflow"
    StartAt = "Scrape"
    States = {
      # Step 1: Run the scraper to fetch new announcements
      Scrape = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.scraper_lambda_arn
          Payload = {
            "max_pages.$" = "$.max_pages"
          }
        }
        ResultPath = "$.scraperResult"
        ResultSelector = {
          "total_announcements.$" = "$.Payload.total_announcements"
          "new_filings.$"         = "$.Payload.new_filings"
          "updated_filings.$"     = "$.Payload.updated_filings"
          "filing_ids.$"          = "$.Payload.filing_ids"
          "errors.$"              = "$.Payload.errors"
        }
        Next = "CheckNewFilings"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # Step 2: Check if there are new filings to process
      CheckNewFilings = {
        Type = "Choice"
        Choices = [{
          Variable           = "$.scraperResult.new_filings"
          NumericGreaterThan = 0
          Next               = "TriggerDownloads"
        }]
        Default = "NotifyNoNewFilings"
      }

      # Step 3: Trigger downloads for new filings
      TriggerDownloads = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.download_trigger_lambda_arn
          Payload = {
            "filing_ids.$" = "$.scraperResult.filing_ids"
            "batch_size"   = 100
          }
        }
        ResultPath = "$.downloadResult"
        ResultSelector = {
          "batches_sent.$"   = "$.Payload.batches_sent"
          "filings_queued.$" = "$.Payload.filings_queued"
        }
        Next = "WaitForDownloads"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # Step 4: Wait for downloads to complete (polling loop)
      WaitForDownloads = {
        Type    = "Wait"
        Seconds = 300 # Wait 5 minutes
        Next    = "CheckDownloadStatus"
      }

      CheckDownloadStatus = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.check_status_lambda_arn
          Payload      = {}
        }
        ResultPath = "$.statusResult"
        ResultSelector = {
          "pending_downloads.$"      = "$.Payload.pending_downloads"
          "processing_downloads.$"   = "$.Payload.processing_downloads"
          "all_downloads_complete.$" = "$.Payload.all_downloads_complete"
        }
        Next = "AreDownloadsComplete"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      AreDownloadsComplete = {
        Type = "Choice"
        Choices = [{
          Variable      = "$.statusResult.all_downloads_complete"
          BooleanEquals = true
          Next          = "TriggerExtractions"
        }]
        Default = "IncrementWaitCounter"
      }

      IncrementWaitCounter = {
        Type = "Pass"
        Parameters = {
          "waitCount.$" = "States.MathAdd($.waitCount, 1)"
        }
        ResultPath = "$.counter"
        Next       = "CheckWaitLimit"
      }

      CheckWaitLimit = {
        Type = "Choice"
        Choices = [{
          Variable           = "$.counter.waitCount"
          NumericGreaterThan = 12                   # Max 12 iterations = 1 hour
          Next               = "TriggerExtractions" # Proceed anyway after timeout
        }]
        Default = "WaitForDownloads"
      }

      # Step 5: Trigger extractions for completed downloads
      TriggerExtractions = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.extraction_trigger_lambda_arn
          Payload = {
            "batch_size"    = 50
            "document_type" = "PDF"
          }
        }
        ResultPath = "$.extractionResult"
        ResultSelector = {
          "batches_sent.$"   = "$.Payload.batches_sent"
          "filings_queued.$" = "$.Payload.filings_queued"
        }
        Next = "NotifySuccess"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # Final notification states
      NotifySuccess = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.notify_lambda_arn
          Payload = {
            "status"                    = "SUCCESS"
            "total_announcements.$"     = "$.scraperResult.total_announcements"
            "new_filings.$"             = "$.scraperResult.new_filings"
            "updated_filings.$"         = "$.scraperResult.updated_filings"
            "download_batches_sent.$"   = "$.downloadResult.batches_sent"
            "downloads_queued.$"        = "$.downloadResult.filings_queued"
            "extraction_batches_sent.$" = "$.extractionResult.batches_sent"
            "extractions_queued.$"      = "$.extractionResult.filings_queued"
          }
        }
        End = true
      }

      NotifyNoNewFilings = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.notify_lambda_arn
          Payload = {
            "status"                = "SUCCESS"
            "total_announcements.$" = "$.scraperResult.total_announcements"
            "new_filings"           = 0
            "updated_filings.$"     = "$.scraperResult.updated_filings"
          }
        }
        End = true
      }

      NotifyFailure = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.notify_lambda_arn
          Payload = {
            "status"  = "FAILED"
            "error.$" = "$.error.Cause"
          }
        }
        End = true
      }
    }
  })

  tags = var.tags
}

output "state_machine_arn" {
  value = aws_sfn_state_machine.hkex_workflow.arn
}

output "state_machine_name" {
  value = aws_sfn_state_machine.hkex_workflow.name
}
