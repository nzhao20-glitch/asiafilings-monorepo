# =============================================================================
# HKEXScraper Makefile
# =============================================================================

.PHONY: help test build build-lambdas build-scraper-lambda \
        build-sfn-downloader build-orchestrator-lambdas build-check-status build-download-trigger \
        build-notify build-write-manifest build-generate-chunks build-batch-worker clean

# Default target
help:
	@echo "HKEXScraper - Available commands:"
	@echo ""
	@echo "Testing:"
	@echo "  make test              - Run all Go tests"
	@echo ""
	@echo "Building:"
	@echo "  make build             - Build Go binaries (tools)"
	@echo "  make build-lambdas     - Build all Lambda zip packages"
	@echo "  make build-scraper-lambda     - Build scraper Lambda"
	@echo "  make build-downloader-lambda  - Build SQS downloader Lambda"
	@echo "  make build-sfn-downloader     - Build Step Functions downloader Lambda"
	@echo "  make build-orchestrator-lambdas - Build all orchestrator Lambdas"
	@echo "  make build-write-manifest     - Build write-manifest Lambda"
	@echo "  make build-generate-chunks    - Build generate-chunks Lambda"
	@echo "  make build-batch-worker       - Build batch-worker Docker image"
	@echo ""
	@echo "Cleanup:"
	@echo "  make clean             - Remove build artifacts"

# =============================================================================
# Testing
# =============================================================================

test:
	@echo "Running Go tests..."
	go test ./... -v

# =============================================================================
# Building
# =============================================================================

build:
	@echo "Building Go binaries..."
	go build -o bin/job-generator ./tools/job-generator

# Build all Lambda functions for deployment
build-lambdas: build-scraper-lambda build-orchestrator-lambdas build-sfn-downloader
	@echo "All Lambda functions built."

build-scraper-lambda:
	@echo "Building scraper Lambda..."
	@mkdir -p services/scraper/cmd/scraper-lambda
	cd services/scraper/cmd/scraper-lambda && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j scraper-lambda.zip bootstrap && \
		rm bootstrap
	@echo "Created services/scraper/cmd/scraper-lambda/scraper-lambda.zip"

build-sfn-downloader:
	@echo "Building Step Functions downloader Lambda..."
	cd services/downloader/cmd/sfn-downloader && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j sfn-downloader.zip bootstrap && \
		rm bootstrap
	@echo "Created services/downloader/cmd/sfn-downloader/sfn-downloader.zip"

build-orchestrator-lambdas: build-check-status build-download-trigger build-notify build-write-manifest build-generate-chunks
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

build-notify:
	@echo "Building notify Lambda..."
	cd services/orchestrator/cmd/notify && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j notify.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/notify/notify.zip"

build-write-manifest:
	@echo "Building write-manifest Lambda..."
	cd services/orchestrator/cmd/write-manifest && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j write-manifest.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/write-manifest/write-manifest.zip"

build-generate-chunks:
	@echo "Building generate-chunks Lambda..."
	cd services/orchestrator/cmd/generate-chunks && \
		GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap . && \
		zip -j generate-chunks.zip bootstrap && \
		rm bootstrap
	@echo "Created services/orchestrator/cmd/generate-chunks/generate-chunks.zip"

build-batch-worker:
	@echo "Building batch-worker Docker image..."
	docker build -f services/downloader/cmd/batch-worker/Dockerfile -t hkex-batch-worker .
	@echo "Built hkex-batch-worker Docker image"

# =============================================================================
# Cleanup
# =============================================================================

clean:
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	rm -f services/scraper/cmd/scraper-lambda/scraper-lambda.zip
	rm -f services/downloader/cmd/downloader-lambda/downloader-lambda.zip
	rm -f services/downloader/cmd/sfn-downloader/sfn-downloader.zip
	rm -f services/orchestrator/cmd/write-manifest/write-manifest.zip
	rm -f services/orchestrator/cmd/generate-chunks/generate-chunks.zip
	rm -f services/orchestrator/cmd/*/bootstrap
	rm -f services/orchestrator/cmd/*/*.zip
	@echo "Done."
