package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TriggerInput is the input from Step Functions
type TriggerInput struct {
	BatchSize    int    `json:"batch_size,omitempty"`    // Size of each SQS batch
	Limit        int    `json:"limit,omitempty"`         // Max total filings to process
	DocumentType string `json:"document_type,omitempty"` // Filter by document type (PDF, HTML, etc.)
}

// TriggerOutput is the output for Step Functions
type TriggerOutput struct {
	TotalFilings   int `json:"total_filings"`
	BatchesSent    int `json:"batches_sent"`
	FilingsQueued  int `json:"filings_queued"`
}

// BatchJob matches the format expected by the extraction Lambda
type BatchJob struct {
	FilingIDs []string `json:"filing_ids"`
}

func Handler(ctx context.Context, input TriggerInput) (*TriggerOutput, error) {
	log.Println("Triggering extractions...")

	// Set defaults
	batchSize := input.BatchSize
	if batchSize <= 0 {
		batchSize = 50 // Smaller batches for extraction (heavier processing)
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 10000
	}
	documentType := input.DocumentType
	if documentType == "" {
		documentType = "PDF"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	queueURL := os.Getenv("SQS_EXTRACTION_QUEUE_URL")

	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}
	if queueURL == "" {
		return nil, fmt.Errorf("SQS_EXTRACTION_QUEUE_URL not set")
	}

	// Connect to database
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	defer pool.Close()

	// Query filings ready for extraction (completed downloads that need extraction)
	query := `
		SELECT exchange || ':' || source_id FROM filings
		WHERE processing_status = 'COMPLETED'
		AND pdf_s3_key IS NOT NULL
		AND (extraction_status IS NULL OR extraction_status = 'PENDING')
	`
	if documentType != "ALL" {
		query += fmt.Sprintf(" AND document_type = '%s'", documentType)
	}
	query += " ORDER BY report_date DESC LIMIT $1"

	rows, err := pool.Query(ctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("querying filings for extraction: %w", err)
	}
	defer rows.Close()

	var filingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scanning filing ID: %w", err)
		}
		filingIDs = append(filingIDs, id)
	}

	log.Printf("Found %d filings ready for extraction", len(filingIDs))

	if len(filingIDs) == 0 {
		return &TriggerOutput{
			TotalFilings:  0,
			BatchesSent:   0,
			FilingsQueued: 0,
		}, nil
	}

	// Create SQS client
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}
	sqsClient := sqs.NewFromConfig(cfg)

	// Send batches to SQS
	output := &TriggerOutput{
		TotalFilings: len(filingIDs),
	}

	for i := 0; i < len(filingIDs); i += batchSize {
		end := i + batchSize
		if end > len(filingIDs) {
			end = len(filingIDs)
		}

		batch := filingIDs[i:end]
		job := BatchJob{FilingIDs: batch}

		jobJSON, err := json.Marshal(job)
		if err != nil {
			log.Printf("Error marshaling batch: %v", err)
			continue
		}

		_, err = sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
			QueueUrl:    aws.String(queueURL),
			MessageBody: aws.String(string(jobJSON)),
		})
		if err != nil {
			log.Printf("Error sending batch to SQS: %v", err)
			continue
		}

		output.BatchesSent++
		output.FilingsQueued += len(batch)
	}

	log.Printf("Sent %d batches with %d filings to extraction queue", output.BatchesSent, output.FilingsQueued)

	return output, nil
}

func main() {
	lambda.Start(Handler)
}
