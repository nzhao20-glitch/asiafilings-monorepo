.PHONY: help build push build-ocr push-ocr deploy-infra destroy-infra test-local

# Variables
AWS_REGION ?= ap-east-1
ECR_REPO ?= filing-etl
OCR_ECR_REPO ?= filing-etl-ocr
IMAGE_TAG ?= latest

help:
	@echo "Filing ETL Pipeline - Available Commands"
	@echo ""
	@echo "Docker:"
	@echo "  make build          Build ETL worker Docker image"
	@echo "  make push           Push image to ECR"
	@echo "  make build-ocr      Build OCR worker Docker image (preloaded)"
	@echo "  make push-ocr       Push OCR image to ECR and print immutable URI"
	@echo ""
	@echo "Infrastructure:"
	@echo "  make deploy-infra   Deploy Terraform infrastructure"
	@echo "  make destroy-infra  Destroy Terraform infrastructure"
	@echo ""
	@echo "Local Development:"
	@echo "  make test-local     Run ETL worker locally with test PDF"
	@echo ""
	@echo "Batch Operations:"
	@echo "  make generate-manifest  Generate manifest from S3 bucket"
	@echo "  make trigger-batch      Submit AWS Batch job"

# Docker build
build:
	cd etl_worker && docker build --platform linux/arm64 -t $(ECR_REPO):$(IMAGE_TAG) .

# ECR login and push
push: build
	@echo "Logging into ECR..."
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com
	@echo "Tagging and pushing image..."
	docker tag $(ECR_REPO):$(IMAGE_TAG) $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(ECR_REPO):$(IMAGE_TAG)
	docker push $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(ECR_REPO):$(IMAGE_TAG)

# OCR Docker build
build-ocr:
	cd etl_worker && docker build --platform linux/arm64 -f Dockerfile.ocr -t $(OCR_ECR_REPO):$(IMAGE_TAG) .

# OCR ECR login and push (prints immutable URI for Terraform)
push-ocr: build-ocr
	@echo "Logging into ECR..."
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com
	@echo "Ensuring OCR ECR repository exists..."
	aws ecr describe-repositories --repository-names $(OCR_ECR_REPO) --region $(AWS_REGION) >/dev/null 2>&1 || aws ecr create-repository --repository-name $(OCR_ECR_REPO) --region $(AWS_REGION) >/dev/null
	@echo "Tagging and pushing OCR image..."
	docker tag $(OCR_ECR_REPO):$(IMAGE_TAG) $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(OCR_ECR_REPO):$(IMAGE_TAG)
	docker push $$(aws sts get-caller-identity --query Account --output text).dkr.ecr.$(AWS_REGION).amazonaws.com/$(OCR_ECR_REPO):$(IMAGE_TAG)
	@echo "Resolving image digest..."
	@ACCOUNT_ID=$$(aws sts get-caller-identity --query Account --output text); \
	DIGEST=$$(aws ecr describe-images --region $(AWS_REGION) --repository-name $(OCR_ECR_REPO) --image-ids imageTag=$(IMAGE_TAG) --query 'imageDetails[0].imageDigest' --output text); \
	echo "Set this in apps/data-pipeline/infra/terraform.tfvars:"; \
	echo "ocr_ecr_image_uri = \"$$ACCOUNT_ID.dkr.ecr.$(AWS_REGION).amazonaws.com/$(OCR_ECR_REPO)@$$DIGEST\""

# Terraform deploy
deploy-infra:
	cd infra && terraform init && terraform apply

# Terraform destroy
destroy-infra:
	cd infra && terraform destroy

# Local testing
test-local:
	cd etl_worker && pip install -r requirements.txt
	cd etl_worker/src && python -c "from extractor import process_pdf_bytes; print('Extractor module OK')"

# Generate manifest
generate-manifest:
	@if [ -z "$(BUCKET)" ]; then echo "Usage: make generate-manifest BUCKET=<bucket> PREFIX=<prefix>"; exit 1; fi
	python scripts/generate_manifest.py --bucket $(BUCKET) --prefix $(PREFIX) --output manifest.csv

# Trigger batch
trigger-batch:
	@if [ -z "$(MANIFEST_BUCKET)" ] || [ -z "$(MANIFEST_KEY)" ]; then \
		echo "Usage: make trigger-batch MANIFEST_BUCKET=<bucket> MANIFEST_KEY=<key>"; \
		exit 1; \
	fi
	python scripts/trigger_batch.py --manifest-bucket $(MANIFEST_BUCKET) --manifest-key $(MANIFEST_KEY)
