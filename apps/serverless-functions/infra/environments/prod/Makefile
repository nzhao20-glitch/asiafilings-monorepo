.PHONY: build package deploy init plan apply destroy clean

# Build the Lambda function for ARM64 Linux
build:
	cd ../.. && GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o deployments/terraform/bootstrap lambda/downloader/main.go lambda/downloader/postgres.go

# Package the Lambda function
package: build
	zip -j function.zip bootstrap
	rm bootstrap

# Deploy to AWS
deploy: package
	terraform apply -auto-approve

# Initialize Terraform
init:
	terraform init

# Plan Terraform changes
plan: package
	terraform plan

# Apply Terraform changes
apply: package
	terraform apply

# Destroy all resources
destroy:
	terraform destroy

# Clean up build artifacts
clean:
	rm -f bootstrap function.zip

# Update Lambda code only (faster than full deploy)
update-lambda: package
	aws lambda update-function-code \
		--function-name $$(terraform output -raw lambda_function_name) \
		--zip-file fileb://function.zip

# Show queue status
queue-status:
	@echo "Queue messages:"
	@aws sqs get-queue-attributes \
		--queue-url $$(terraform output -raw sqs_queue_url) \
		--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

# Show DLQ status
dlq-status:
	@echo "Dead letter queue messages:"
	@aws sqs get-queue-attributes \
		--queue-url $$(terraform output -raw sqs_dlq_url) \
		--attribute-names ApproximateNumberOfMessages

# View Lambda logs
logs:
	aws logs tail /aws/lambda/$$(terraform output -raw lambda_function_name) --follow

# Get outputs
outputs:
	terraform output

# =============================================================================
# Meilisearch Indexer Lambda (Python)
# =============================================================================

# Package meilisearch-indexer Lambda
package-indexer:
	cd ../../lambda/meilisearch-indexer && zip -r ../../deployments/terraform/meilisearch-indexer.zip *.py

# Deploy meilisearch-indexer Lambda only
deploy-indexer: package-indexer
	terraform apply -target=aws_lambda_function.indexer -auto-approve

# Update meilisearch-indexer Lambda code
update-indexer: package-indexer
	aws lambda update-function-code \
		--function-name $$(terraform output -raw indexer_lambda_name) \
		--zip-file fileb://meilisearch-indexer.zip

# Show indexer queue status
indexer-queue-status:
	@echo "Indexer queue messages:"
	@aws sqs get-queue-attributes \
		--queue-url $$(terraform output -raw indexer_queue_url) \
		--attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible

# View indexer Lambda logs
indexer-logs:
	aws logs tail /aws/lambda/$$(terraform output -raw indexer_lambda_name) --follow

# Clean all artifacts
clean-all: clean
	rm -f meilisearch-indexer.zip
