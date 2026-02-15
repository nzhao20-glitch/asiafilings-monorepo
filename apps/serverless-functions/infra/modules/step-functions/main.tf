# Step Functions State Machine for HKEX Filing Ingestion Workflow
#
# Two execution paths:
#
#   Daily (no start_date):
#     Scrape → CheckNewFilings → RouteBySize →
#       ≤1000: Map(DownloadFilings) → NotifySuccess
#       >1000: WriteManifest → BatchDownload → NotifySuccess
#
#   Backfill (start_date + end_date provided):
#     GenerateChunks → BackfillMonths Map(MaxConcurrency=1):
#       ScrapeMonth → CheckMonthFilings →
#         Has filings: WriteMonthManifest → BatchDownloadMonth → MonthDone
#         No filings:  MonthNoFilings
#     → NotifyBackfillSuccess
#
# Backfill always uses Batch (avoids nested Map 25k event limit).
# Each month's errors are isolated via Catch → MonthFailed.
#
# -----------------------------------------------------------------------
# Manual backfill via AWS CLI:
#
#   aws stepfunctions start-execution \
#     --state-machine-arn "<STATE_MACHINE_ARN>" \
#     --input '{"start_date":"2024-01-01","end_date":"2024-06-30","market":"SEHK"}'
#
# Omit start_date/end_date for the default last-24-hours daily behavior.
# -----------------------------------------------------------------------

variable "name_prefix" {
  description = "Prefix for resource names"
  type        = string
}

variable "scraper_lambda_arn" {
  description = "ARN of the scraper Lambda"
  type        = string
}

variable "sfn_downloader_lambda_arn" {
  description = "ARN of the Step Functions downloader Lambda (single-filing handler)"
  type        = string
}

variable "notify_lambda_arn" {
  description = "ARN of the notify Lambda"
  type        = string
}

variable "download_max_concurrency" {
  description = "Max concurrent download Lambda invocations in the Map state (protects HKEX rate limits)"
  type        = number
  default     = 10
}

variable "write_manifest_lambda_arn" {
  description = "ARN of the write-manifest Lambda"
  type        = string
}

variable "batch_job_queue_arn" {
  description = "ARN of the Batch job queue for large downloads"
  type        = string
}

variable "batch_job_definition_arn" {
  description = "ARN of the Batch job definition for downloads"
  type        = string
}

variable "batch_filing_threshold" {
  description = "Filing count threshold above which Batch is used instead of Map"
  type        = number
  default     = 1000
}

variable "generate_chunks_lambda_arn" {
  description = "ARN of the generate-chunks Lambda (backfill date range splitter)"
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
        var.sfn_downloader_lambda_arn,
        var.notify_lambda_arn,
        var.write_manifest_lambda_arn,
        var.generate_chunks_lambda_arn
      ]
    }]
  })
}

resource "aws_iam_role_policy" "step_functions_batch" {
  name = "${var.name_prefix}-batch-access"
  role = aws_iam_role.step_functions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "batch:SubmitJob",
          "batch:DescribeJobs",
          "batch:TerminateJob"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "events:PutTargets",
          "events:PutRule",
          "events:DescribeRule"
        ]
        Resource = "*"
      }
    ]
  })
}

# State Machine Definition
resource "aws_sfn_state_machine" "hkex_workflow" {
  name     = "${var.name_prefix}-daily-workflow"
  role_arn = aws_iam_role.step_functions.arn

  definition = jsonencode({
    Comment = "HKEX Filing Ingestion Workflow — Daily (Scrape → Download) or Backfill (monthly chunks via Map → Batch)"
    StartAt = "IsBackfill"
    States = {

      # ---------------------------------------------------------------
      # Entry point: route daily runs vs. backfills.
      # Backfills provide start_date; daily runs omit it.
      # ---------------------------------------------------------------
      IsBackfill = {
        Type = "Choice"
        Choices = [{
          Variable  = "$.start_date"
          IsPresent = true
          Next      = "GenerateChunks"
        }]
        Default = "Scrape"
      }

      # ===============================================================
      # BACKFILL PATH
      # ===============================================================

      # Split the date range into monthly chunks
      GenerateChunks = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.generate_chunks_lambda_arn
          "Payload.$"  = "$"
        }
        ResultPath = "$.chunksResult"
        ResultSelector = {
          "chunks.$" = "$.Payload.chunks"
        }
        Next = "BackfillMonths"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # Iterate over monthly chunks sequentially (MaxConcurrency=1)
      BackfillMonths = {
        Type           = "Map"
        ItemsPath      = "$.chunksResult.chunks"
        MaxConcurrency = 1
        ItemProcessor = {
          ProcessorConfig = {
            Mode = "INLINE"
          }
          StartAt = "ScrapeMonth"
          States = {

            ScrapeMonth = {
              Type     = "Task"
              Resource = "arn:aws:states:::lambda:invoke"
              Parameters = {
                FunctionName = var.scraper_lambda_arn
                "Payload.$"  = "$"
              }
              ResultPath = "$.scraperResult"
              ResultSelector = {
                "total_announcements.$" = "$.Payload.total_announcements"
                "new_filings.$"         = "$.Payload.new_filings"
                "updated_filings.$"     = "$.Payload.updated_filings"
                "filings.$"             = "$.Payload.filings"
                "errors.$"              = "$.Payload.errors"
              }
              Next = "CheckMonthFilings"
              Catch = [{
                ErrorEquals = ["States.ALL"]
                Next        = "MonthFailed"
                ResultPath  = "$.error"
              }]
            }

            CheckMonthFilings = {
              Type = "Choice"
              Choices = [{
                Variable           = "$.scraperResult.new_filings"
                NumericGreaterThan = 0
                Next               = "WriteMonthManifest"
              }]
              Default = "MonthNoFilings"
            }

            WriteMonthManifest = {
              Type     = "Task"
              Resource = "arn:aws:states:::lambda:invoke"
              Parameters = {
                FunctionName = var.write_manifest_lambda_arn
                Payload = {
                  "filings.$" = "$.scraperResult.filings"
                }
              }
              ResultPath = "$.manifestResult"
              ResultSelector = {
                "manifest_bucket.$" = "$.Payload.manifest_bucket"
                "manifest_key.$"    = "$.Payload.manifest_key"
                "array_size.$"      = "$.Payload.array_size"
                "total_filings.$"   = "$.Payload.total_filings"
                "chunk_size.$"      = "$.Payload.chunk_size"
              }
              Next = "BatchDownloadMonth"
              Catch = [{
                ErrorEquals = ["States.ALL"]
                Next        = "MonthFailed"
                ResultPath  = "$.error"
              }]
            }

            BatchDownloadMonth = {
              Type     = "Task"
              Resource = "arn:aws:states:::batch:submitJob.sync"
              Parameters = {
                JobName         = "backfill-download"
                "JobQueue"      = var.batch_job_queue_arn
                "JobDefinition" = var.batch_job_definition_arn
                "ArrayProperties" = {
                  "Size.$" = "$.manifestResult.array_size"
                }
                "ContainerOverrides" = {
                  "Environment" = [
                    { "Name" = "MANIFEST_BUCKET", "Value.$" = "$.manifestResult.manifest_bucket" },
                    { "Name" = "MANIFEST_KEY", "Value.$" = "$.manifestResult.manifest_key" }
                  ]
                }
              }
              ResultPath = "$.batchResult"
              Next       = "MonthDone"
              Retry = [{
                ErrorEquals     = ["States.TaskFailed"]
                IntervalSeconds = 60
                MaxAttempts     = 3
                BackoffRate     = 2.0
              }]
              Catch = [{
                ErrorEquals = ["States.ALL"]
                Next        = "MonthFailed"
                ResultPath  = "$.error"
              }]
            }

            MonthDone = {
              Type = "Pass"
              Parameters = {
                "month.$"      = "$.start_date"
                "new_filings.$" = "$.scraperResult.new_filings"
                status          = "completed"
              }
              End = true
            }

            MonthNoFilings = {
              Type = "Pass"
              Parameters = {
                "month.$"   = "$.start_date"
                new_filings = 0
                status      = "skipped"
              }
              End = true
            }

            MonthFailed = {
              Type = "Pass"
              Parameters = {
                "month.$"   = "$.start_date"
                new_filings = 0
                status      = "failed"
                "error.$"   = "$.error"
              }
              End = true
            }
          }
        }
        ResultPath = "$.backfillResults"
        Next       = "NotifyBackfillSuccess"
      }

      NotifyBackfillSuccess = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.notify_lambda_arn
          Payload = {
            status  = "SUCCESS"
            message = "Backfill completed"
            "months_processed.$" = "$.backfillResults"
          }
        }
        End = true
      }

      # ===============================================================
      # DAILY PATH (unchanged)
      # ===============================================================

      # ---------------------------------------------------------------
      # Step 1: Run the scraper to discover new filings in a date range.
      # Input is passed through from EventBridge or manual invocation.
      # Daily runs omit dates (defaults to last 24 h inside the Lambda).
      # ---------------------------------------------------------------
      Scrape = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.scraper_lambda_arn
          "Payload.$"  = "$"
        }
        ResultPath = "$.scraperResult"
        ResultSelector = {
          "total_announcements.$" = "$.Payload.total_announcements"
          "new_filings.$"         = "$.Payload.new_filings"
          "updated_filings.$"     = "$.Payload.updated_filings"
          "filings.$"             = "$.Payload.filings"
          "errors.$"              = "$.Payload.errors"
        }
        Next = "CheckNewFilings"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # ---------------------------------------------------------------
      # Step 2: Branch — skip downloads if the scraper found nothing new.
      # ---------------------------------------------------------------
      CheckNewFilings = {
        Type = "Choice"
        Choices = [{
          Variable           = "$.scraperResult.new_filings"
          NumericGreaterThan = 0
          Next               = "RouteBySize"
        }]
        Default = "NotifyNoNewFilings"
      }

      # ---------------------------------------------------------------
      # Step 2b: Route by filing count — small batches use Lambda Map,
      # large batches use AWS Batch (Fargate Spot).
      # ---------------------------------------------------------------
      RouteBySize = {
        Type = "Choice"
        Choices = [{
          Variable           = "$.scraperResult.new_filings"
          NumericGreaterThan = var.batch_filing_threshold
          Next               = "WriteManifest"
        }]
        Default = "DownloadFilings"
      }

      # ---------------------------------------------------------------
      # Step 2c: Write manifest to S3 for Batch array job consumption.
      # ---------------------------------------------------------------
      WriteManifest = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.write_manifest_lambda_arn
          Payload = {
            "filings.$" = "$.scraperResult.filings"
          }
        }
        ResultPath = "$.manifestResult"
        ResultSelector = {
          "manifest_bucket.$" = "$.Payload.manifest_bucket"
          "manifest_key.$"    = "$.Payload.manifest_key"
          "array_size.$"      = "$.Payload.array_size"
          "total_filings.$"   = "$.Payload.total_filings"
          "chunk_size.$"      = "$.Payload.chunk_size"
        }
        Next = "BatchDownload"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # ---------------------------------------------------------------
      # Step 2d: Submit Batch array job and wait for completion (.sync).
      # ---------------------------------------------------------------
      BatchDownload = {
        Type     = "Task"
        Resource = "arn:aws:states:::batch:submitJob.sync"
        Parameters = {
          JobName               = "batch-download"
          "JobQueue"            = var.batch_job_queue_arn
          "JobDefinition"       = var.batch_job_definition_arn
          "ArrayProperties" = {
            "Size.$" = "$.manifestResult.array_size"
          }
          "ContainerOverrides" = {
            "Environment" = [
              { "Name" = "MANIFEST_BUCKET", "Value.$" = "$.manifestResult.manifest_bucket" },
              { "Name" = "MANIFEST_KEY", "Value.$" = "$.manifestResult.manifest_key" }
            ]
          }
        }
        ResultPath = "$.batchResult"
        Next       = "NotifySuccess"
        Retry = [{
          ErrorEquals     = ["States.TaskFailed"]
          IntervalSeconds = 60
          MaxAttempts     = 3
          BackoffRate     = 2.0
        }]
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # ---------------------------------------------------------------
      # Step 3: Map state — invoke the downloader Lambda once per filing.
      # MaxConcurrency throttles parallel invocations to respect HKEX
      # rate limits. Each iteration receives one FilingPayload element.
      # ---------------------------------------------------------------
      DownloadFilings = {
        Type           = "Map"
        ItemsPath      = "$.scraperResult.filings"
        MaxConcurrency = var.download_max_concurrency
        ItemProcessor = {
          ProcessorConfig = {
            Mode = "INLINE"
          }
          StartAt = "DownloadSingleFiling"
          States = {
            DownloadSingleFiling = {
              Type     = "Task"
              Resource = "arn:aws:states:::lambda:invoke"
              Parameters = {
                FunctionName = var.sfn_downloader_lambda_arn
                "Payload.$"  = "$"
              }
              ResultSelector = {
                "source_id.$" = "$.Payload.source_id"
                "success.$"   = "$.Payload.success"
                "s3_key.$"    = "$.Payload.s3_key"
                "error.$"     = "$.Payload.error"
              }
              End = true
              Retry = [{
                ErrorEquals     = ["States.TaskFailed", "Lambda.ServiceException", "Lambda.TooManyRequestsException"]
                IntervalSeconds = 30
                MaxAttempts     = 2
                BackoffRate     = 2.0
              }]
            }
          }
        }
        ResultPath = "$.downloadResults"
        Next       = "NotifySuccess"
        Catch = [{
          ErrorEquals = ["States.ALL"]
          Next        = "NotifyFailure"
          ResultPath  = "$.error"
        }]
      }

      # ---------------------------------------------------------------
      # Final notification states
      # ---------------------------------------------------------------
      NotifySuccess = {
        Type     = "Task"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = var.notify_lambda_arn
          Payload = {
            "status"                = "SUCCESS"
            "total_announcements.$" = "$.scraperResult.total_announcements"
            "new_filings.$"         = "$.scraperResult.new_filings"
            "updated_filings.$"     = "$.scraperResult.updated_filings"
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
