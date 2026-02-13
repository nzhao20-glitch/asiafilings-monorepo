# =============================================================================
# HKEXScraper Makefile
# =============================================================================

.PHONY: help test test-extractor build build-lambdas build-scraper-lambda build-downloader-lambda \
        build-orchestrator-lambdas build-check-status build-download-trigger build-extraction-trigger \
        build-notify package-extractor build-layer publish-layer deploy-extractor update-extractor \
        extraction-queue-status extraction-dlq-status extraction-logs clean

# Default target
help:
	@echo "HKEXScraper - Available commands:"
	@echo ""
	@echo "Testing:"
	@echo "  make test              - Run all tests"
	@echo "  make test-extractor    - Run extractor Lambda tests only"
	@echo ""
	@echo "Building:"
	@echo "  make build             - Build Go binaries (tools)"
	@echo "  make build-lambdas     - Build all Lambda zip packages"
	@echo "  make build-scraper-lambda     - Build scraper Lambda"
	@echo "  make build-downloader-lambda  - Build downloader Lambda"
	@echo "  make build-orchestrator-lambdas - Build all orchestrator Lambdas"
	@echo "  make build-layer       - Build PyMuPDF Lambda layer (Docker)"
	@echo "  make publish-layer     - Build and publish layer to AWS"
	@echo "  make package-extractor - Package extractor Lambda"
	@echo ""
	@echo "Deployment:"
	@echo "  make deploy-extractor  - Deploy extraction infrastructure"
	@echo "  make update-extractor  - Update Lambda code only (fast)"
	@echo ""
	@echo "Monitoring:"
	@echo "  make extraction-queue-status - Check SQS queue message count"
	@echo "  make extraction-dlq-status   - Check dead letter queue"
	@echo "  make extraction-logs         - Tail Lambda logs"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean             - Remove build artifacts"

# =============================================================================
# Testing
# =============================================================================

test: test-go test-extractor

test-go:
	@echo "Running Go tests..."
	go test ./... -v

test-extractor:
	@echo "Running extractor Lambda tests..."
	cd lambda/extractor && pip install -q -r requirements.txt pytest && pytest -v

test-extractor-cov:
	@echo "Running extractor tests with coverage..."
	cd lambda/extractor && pip install -q -r requirements.txt pytest pytest-cov && \
		pytest --cov=. --cov-report=term-missing --cov-fail-under=80 -v

# =============================================================================
# Building
# =============================================================================

build:
	@echo "Building Go binaries..."
	go build -o bin/job-generator ./tools/job-generator

# Build all Lambda functions for deployment
build-lambdas: build-scraper-lambda build-orchestrator-lambdas build-downloader-lambda
	@echo "All Lambda functions built."

build-scraper-lambda:
	@echo "Building scraper Lambda..."
	@mkdir -p services/scraper/cmd/scraper-lambda
	cd services/scraper/cmd/scraper-lambda && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j scraper-lambda.zip bootstrap && \
		rm bootstrap
	@echo "Created services/scraper/cmd/scraper-lambda/scraper-lambda.zip"

build-downloader-lambda:
	@echo "Building downloader Lambda..."
	@mkdir -p services/downloader/cmd/downloader-lambda
	cd services/downloader/cmd/downloader-lambda && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j downloader-lambda.zip bootstrap && \
		rm bootstrap
	@echo "Created services/downloader/cmd/downloader-lambda/downloader-lambda.zip"

build-orchestrator-lambdas: build-check-status build-download-trigger build-extraction-trigger build-notify
	@echo "All orchestrator Lambdas built."

build-check-status:
	@echo "Building check-status Lambda..."
	cd services/orchestrator/cmd/check-status && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j check-status.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/check-status/check-status.zip"

build-download-trigger:
	@echo "Building download-trigger Lambda..."
	cd services/orchestrator/cmd/download-trigger && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j download-trigger.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/download-trigger/download-trigger.zip"

build-extraction-trigger:
	@echo "Building extraction-trigger Lambda..."
	cd services/orchestrator/cmd/extraction-trigger && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j extraction-trigger.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/extraction-trigger/extraction-trigger.zip"

build-notify:
	@echo "Building notify Lambda..."
	cd services/orchestrator/cmd/notify && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j notify.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/notify/notify.zip"

build-layer:
	@echo "Building PyMuPDF Lambda layer..."
	./scripts/build_layer.sh

publish-layer:
	@echo "Building and publishing PyMuPDF Lambda layer..."
	./scripts/build_layer.sh --publish

package-extractor:
	@echo "Packaging extractor Lambda..."
	@mkdir -p deployments/terraform
	cd lambda/extractor && zip -r ../../deployments/terraform/extractor.zip \
		handler.py extractor.py db.py \
		-x "*.pyc" -x "__pycache__/*" -x "test_*.py" -x "*.egg-info/*"
	@echo "Created deployments/terraform/extractor.zip"
	@ls -lh deployments/terraform/extractor.zip

# =============================================================================
# Deployment
# =============================================================================

deploy-extractor: package-extractor
	@echo "Deploying extraction infrastructure..."
	cd deployments/terraform && terraform apply

update-extractor: package-extractor
	@echo "Updating extractor Lambda code..."
	@FUNCTION_NAME=$$(cd deployments/terraform && terraform output -raw extraction_lambda_name 2>/dev/null) && \
	if [ -n "$$FUNCTION_NAME" ]; then \
		aws lambda update-function-code \
			--function-name $$FUNCTION_NAME \
			--zip-file fileb://deployments/terraform/extractor.zip; \
	else \
		echo "Error: Could not get Lambda function name. Run 'make deploy-extractor' first."; \
		exit 1; \
	fi

# =============================================================================
# Monitoring
# =============================================================================

extraction-queue-status:
	@QUEUE_URL=$$(cd deployments/terraform && terraform output -raw extraction_queue_url 2>/dev/null) && \
	if [ -n "$$QUEUE_URL" ]; then \
		aws sqs get-queue-attributes \
			--queue-url $$QUEUE_URL \
			--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
			--output table; \
	else \
		echo "Error: Could not get queue URL. Run 'make deploy-extractor' first."; \
	fi

extraction-dlq-status:
	@DLQ_URL=$$(cd deployments/terraform && terraform output -raw extraction_dlq_url 2>/dev/null) && \
	if [ -n "$$DLQ_URL" ]; then \
		aws sqs get-queue-attributes \
			--queue-url $$DLQ_URL \
			--attribute-names ApproximateNumberOfMessages \
			--output table; \
	else \
		echo "Error: Could not get DLQ URL. Run 'make deploy-extractor' first."; \
	fi

extraction-logs:
	@FUNCTION_NAME=$$(cd deployments/terraform && terraform output -raw extraction_lambda_name 2>/dev/null) && \
	if [ -n "$$FUNCTION_NAME" ]; then \
		aws logs tail /aws/lambda/$$FUNCTION_NAME --follow; \
	else \
		echo "Error: Could not get Lambda function name. Run 'make deploy-extractor' first."; \
	fi

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	rm -f deployments/terraform/extractor.zip
	rm -f scripts/pymupdf-psycopg2-layer.zip
	rm -f services/scraper/cmd/scraper-lambda/scraper-lambda.zip
	rm -f services/downloader/cmd/downloader-lambda/downloader-lambda.zip
	rm -f services/orchestrator/cmd/*/bootstrap
	rm -f services/orchestrator/cmd/*/*.zip
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
	@echo "Done."

# =============================================================================
# SQL Migration
# =============================================================================

migration-extraction:
	@echo "Run the following SQL to add extraction columns:"
	@echo ""
	@echo "ALTER TABLE filings ADD COLUMN extraction_status TEXT DEFAULT 'PENDING';"
	@echo "ALTER TABLE filings ADD COLUMN extraction_s3_key TEXT;"
	@echo "ALTER TABLE filings ADD COLUMN extraction_error TEXT;"
	@echo "ALTER TABLE filings ADD COLUMN extraction_at TIMESTAMP;"
	@echo ""
	@echo "CREATE INDEX idx_filings_extraction_status ON filings(extraction_status);"
