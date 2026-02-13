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
	FilingIDs []string `json:"filing_ids,omitempty"` // Specific IDs to process (from scraper)
	BatchSize int      `json:"batch_size,omitempty"` // Size of each SQS batch
	Limit     int      `json:"limit,omitempty"`      // Max total filings to process
}

// TriggerOutput is the output for Step Functions
type TriggerOutput struct {
	TotalFilings   int `json:"total_filings"`
	BatchesSent    int `json:"batches_sent"`
	FilingsQueued  int `json:"filings_queued"`
}

// BatchJob matches the format expected by the downloader Lambda
type BatchJob struct {
	FilingIDs []string `json:"filing_ids"`
}

func Handler(ctx context.Context, input TriggerInput) (*TriggerOutput, error) {
	log.Println("Triggering downloads...")

	// Set defaults
	batchSize := input.BatchSize
	if batchSize <= 0 {
		batchSize = 100
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 10000 // Default max
	}

	databaseURL := os.Getenv("DATABASE_URL")
	queueURL := os.Getenv("SQS_QUEUE_URL")

	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}
	if queueURL == "" {
		return nil, fmt.Errorf("SQS_QUEUE_URL not set")
	}

	// Connect to database
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	defer pool.Close()

	// Get filing IDs to process
	var filingIDs []string

	if len(input.FilingIDs) > 0 {
		// Use provided IDs
		filingIDs = input.FilingIDs
		log.Printf("Using %d provided filing IDs", len(filingIDs))
	} else {
		// Query pending filings from database
		rows, err := pool.Query(ctx, `
			SELECT source_id FROM filings
			WHERE processing_status = 'PENDING'
			ORDER BY report_date DESC
			LIMIT $1
		`, limit)
		if err != nil {
			return nil, fmt.Errorf("querying pending filings: %w", err)
		}
		defer rows.Close()

		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return nil, fmt.Errorf("scanning filing ID: %w", err)
			}
			filingIDs = append(filingIDs, id)
		}
		log.Printf("Found %d pending filings in database", len(filingIDs))
	}

	if len(filingIDs) == 0 {
		log.Println("No filings to process")
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

	log.Printf("Sent %d batches with %d filings to SQS", output.BatchesSent, output.FilingsQueued)

	return output, nil
}

func main() {
	lambda.Start(Handler)
}
