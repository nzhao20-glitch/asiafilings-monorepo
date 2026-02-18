#!/usr/bin/env bash
# =============================================================================
# Bootstrap: Create Terraform remote state backend (run once)
# =============================================================================
# Creates the S3 bucket and DynamoDB table required for Terraform remote state.
# Run this BEFORE 'terraform init' in the main configuration.
#
# Usage: ./bootstrap.sh
# =============================================================================
set -euo pipefail

BUCKET="asiafilings-terraform-state"
TABLE="asiafilings-terraform-lock"
REGION="ap-east-1"

echo "==> Creating S3 bucket for Terraform state..."
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"

echo "==> Enabling versioning on S3 bucket..."
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

echo "==> Enabling server-side encryption..."
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
  }'

echo "==> Blocking public access..."
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

echo "==> Creating DynamoDB lock table..."
aws dynamodb create-table \
  --table-name "$TABLE" \
  --region "$REGION" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

echo "==> Waiting for DynamoDB table to become active..."
aws dynamodb wait table-exists --table-name "$TABLE" --region "$REGION"

echo ""
echo "State backend ready. Now run:"
echo "  cd apps/web-platform/infra/terraform"
echo "  terraform init"
echo "  terraform plan"
