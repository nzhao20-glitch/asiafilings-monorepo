package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/jackc/pgx/v5/pgxpool"
)

// StatusInput is the input from Step Functions
type StatusInput struct {
	// Can specify which statuses to check
	CheckDownloads   bool `json:"check_downloads,omitempty"`
	CheckExtractions bool `json:"check_extractions,omitempty"`
}

// StatusOutput is the output for Step Functions
type StatusOutput struct {
	PendingDownloads   int  `json:"pending_downloads"`
	ProcessingDownloads int `json:"processing_downloads"`
	CompletedDownloads int  `json:"completed_downloads"`
	FailedDownloads    int  `json:"failed_downloads"`

	PendingExtractions   int `json:"pending_extractions"`
	ProcessingExtractions int `json:"processing_extractions"`
	CompletedExtractions int `json:"completed_extractions"`

	AllDownloadsComplete bool `json:"all_downloads_complete"`
	AllExtractionsComplete bool `json:"all_extractions_complete"`
}

func Handler(ctx context.Context, input StatusInput) (*StatusOutput, error) {
	log.Println("Checking processing status...")

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	defer pool.Close()

	output := &StatusOutput{}

	// Count download statuses
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE processing_status = 'PENDING'`).Scan(&output.PendingDownloads)
	if err != nil {
		return nil, fmt.Errorf("counting pending: %w", err)
	}

	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE processing_status = 'PROCESSING'`).Scan(&output.ProcessingDownloads)
	if err != nil {
		return nil, fmt.Errorf("counting processing: %w", err)
	}

	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE processing_status = 'COMPLETED'`).Scan(&output.CompletedDownloads)
	if err != nil {
		return nil, fmt.Errorf("counting completed: %w", err)
	}

	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE processing_status IN ('FAILED', 'URL_FAILURE', 'RATE_LIMITED')`).Scan(&output.FailedDownloads)
	if err != nil {
		return nil, fmt.Errorf("counting failed: %w", err)
	}

	// Count extraction statuses (if extraction_status column exists)
	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE extraction_status = 'PENDING' OR (processing_status = 'COMPLETED' AND extraction_status IS NULL)`).Scan(&output.PendingExtractions)
	if err != nil {
		// Column might not exist, ignore error
		output.PendingExtractions = 0
	}

	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE extraction_status = 'PROCESSING'`).Scan(&output.ProcessingExtractions)
	if err != nil {
		output.ProcessingExtractions = 0
	}

	err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM filings WHERE extraction_status = 'COMPLETED'`).Scan(&output.CompletedExtractions)
	if err != nil {
		output.CompletedExtractions = 0
	}

	// Determine if all complete
	output.AllDownloadsComplete = output.PendingDownloads == 0 && output.ProcessingDownloads == 0
	output.AllExtractionsComplete = output.PendingExtractions == 0 && output.ProcessingExtractions == 0

	log.Printf("Status: downloads(pending=%d, processing=%d, completed=%d, failed=%d), extractions(pending=%d, processing=%d, completed=%d)",
		output.PendingDownloads, output.ProcessingDownloads, output.CompletedDownloads, output.FailedDownloads,
		output.PendingExtractions, output.ProcessingExtractions, output.CompletedExtractions)

	return output, nil
}

func main() {
	lambda.Start(Handler)
}
