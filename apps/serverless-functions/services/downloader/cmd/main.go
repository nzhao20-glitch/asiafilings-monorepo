package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/nicholaszhao/hkex-scraper/services/downloader"
)

// Config holds Lambda configuration from environment
type Config struct {
	DatabaseURL  string
	S3Bucket     string
	S3Region     string
	ProxyBaseURL string
	Concurrency  int
}

// BatchJob represents a batch of filing IDs to process
type BatchJob struct {
	FilingIDs []string `json:"filing_ids"`
}

// Handler is the Lambda handler function
func Handler(ctx context.Context, sqsEvent events.SQSEvent) error {
	config := loadConfig()
	log.Printf("Lambda starting with %d SQS messages", len(sqsEvent.Records))

	// Create database connection
	db, err := NewPostgresDB(ctx, config.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connecting to database: %w", err)
	}
	defer db.Close()

	// Create S3 client
	s3Client, err := downloader.NewS3ClientWithRegion(ctx, config.S3Region)
	if err != nil {
		return fmt.Errorf("creating S3 client: %w", err)
	}

	// Create downloader with rate-limiting protection
	dlConfig := downloader.Config{
		Concurrency:     config.Concurrency,
		S3Bucket:        config.S3Bucket,
		ProxyBaseURL:    config.ProxyBaseURL,
		Timeout:         30 * time.Second,
		RetryAttempts:   3,
		RetryDelay:      2 * time.Second,
		MinRequestDelay: 100 * time.Millisecond,
		MaxRequestDelay: 500 * time.Millisecond,
	}

	dl := downloader.New(dlConfig)
	dl.SetS3Client(s3Client)

	store := downloader.NewDBStore(db)
	batchDl := downloader.NewBatchDownloader(dl, store)

	// Process each SQS message (each contains a batch of filing IDs)
	var totalProcessed, totalFailed int

	for _, record := range sqsEvent.Records {
		var job BatchJob
		if err := json.Unmarshal([]byte(record.Body), &job); err != nil {
			log.Printf("Error parsing SQS message: %v", err)
			continue
		}

		log.Printf("Processing batch of %d filings", len(job.FilingIDs))

		// Fetch and download filings
		result, err := batchDl.DownloadBatchByIDs(ctx, job.FilingIDs)
		if err != nil {
			log.Printf("Error processing batch: %v", err)
			continue
		}

		totalProcessed += result.Successful
		totalFailed += result.Failed

		log.Printf("Batch complete: %d successful, %d failed (%.1fs)",
			result.Successful, result.Failed, result.Duration.Seconds())
	}

	log.Printf("Lambda complete: %d processed, %d failed", totalProcessed, totalFailed)
	return nil
}

func loadConfig() Config {
	concurrency := 5 // Default: conservative to avoid rate limiting
	if val := os.Getenv("CONCURRENCY"); val != "" {
		fmt.Sscanf(val, "%d", &concurrency)
	}

	return Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		S3Bucket:     os.Getenv("S3_BUCKET"),
		S3Region:     getEnvOrDefault("AWS_REGION", "ap-east-1"),
		ProxyBaseURL: os.Getenv("PROXY_BASE_URL"),
		Concurrency:  concurrency,
	}
}

func getEnvOrDefault(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func main() {
	lambda.Start(Handler)
}
