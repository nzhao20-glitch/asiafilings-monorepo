# =============================================================================
# S3 Data Lake Buckets — Import existing buckets into core state
# =============================================================================
# --- Source PDFs Bucket ---

resource "aws_s3_bucket" "pdfs" {
  bucket = var.s3_pdf_bucket

  lifecycle {
    prevent_destroy = true
  }
}

# --- Filing Extractions Bucket ---

resource "aws_s3_bucket" "extractions" {
  bucket = var.s3_extraction_bucket

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "extractions" {
  bucket = aws_s3_bucket.extractions.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "extractions" {
  bucket = aws_s3_bucket.extractions.id

  rule {
    id     = "archive-old-data"
    status = "Enabled"

    filter {}

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
