package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/downloader"
)

// FilingPayload is the input from the Step Functions Map state.
// Each field is populated by the scraper Lambda output.
type FilingPayload struct {
	SourceID      string `json:"source_id"`
	SourceURL     string `json:"source_url"`
	CompanyID     string `json:"company_id"`
	FileExtension string `json:"file_extension"`
	Exchange      string `json:"exchange"`
	ReportDate    string `json:"report_date"` // RFC3339
}

// DownloadResult is the output returned to Step Functions
type DownloadResult struct {
	SourceID string `json:"source_id"`
	Success  bool   `json:"success"`
	S3Key    string `json:"s3_key,omitempty"`
	FileSize int64  `json:"file_size,omitempty"`
	Error    string `json:"error,omitempty"`
}

// Handler processes a single filing payload from the Step Functions Map state.
// It downloads the document to S3 and updates the filing status in the database.
func Handler(ctx context.Context, payload FilingPayload) (*DownloadResult, error) {
	log.Printf("Downloading filing %s from %s", payload.SourceID, payload.SourceURL)

	// Parse report date
	reportDate, err := time.Parse(time.RFC3339, payload.ReportDate)
	if err != nil {
		return nil, fmt.Errorf("invalid report_date %q: %w", payload.ReportDate, err)
	}

	// Construct Filing model from payload (no DB lookup needed)
	filing := &models.Filing{
		ID:            payload.SourceID,
		SourceID:      payload.SourceID,
		SourceURL:     payload.SourceURL,
		CompanyID:     payload.CompanyID,
		FileExtension: payload.FileExtension,
		Exchange:      payload.Exchange,
		ReportDate:    reportDate,
	}

	// Load config from environment
	s3Bucket := os.Getenv("S3_BUCKET")
	s3Region := getEnvOrDefault("AWS_REGION", "ap-east-1")
	proxyBaseURL := os.Getenv("PROXY_BASE_URL")
	databaseURL := os.Getenv("DATABASE_URL")

	// Create downloader (single filing, conservative rate limiting)
	dlConfig := downloader.Config{
		Concurrency:     1,
		S3Bucket:        s3Bucket,
		ProxyBaseURL:    proxyBaseURL,
		Timeout:         30 * time.Second,
		RetryAttempts:   3,
		RetryDelay:      5 * time.Second,
		MinRequestDelay: 500 * time.Millisecond,
		MaxRequestDelay: 2 * time.Second,
	}
	dl := downloader.New(dlConfig)

	// Create S3 client
	if s3Bucket != "" {
		s3Client, err := downloader.NewS3ClientWithRegion(ctx, s3Region)
		if err != nil {
			return nil, fmt.Errorf("creating S3 client: %w", err)
		}
		dl.SetS3Client(s3Client)
	}

	// Download the filing
	result := dl.Download(ctx, filing)

	// Determine processing status
	var status models.ProcessingStatus
	var errorMsg string

	if result.Success {
		status = models.ProcessingStatusCompleted
	} else if downloader.IsURLNotFoundError(result.Error) {
		status = models.ProcessingStatusURLFailure
	} else if downloader.IsRateLimitError(result.Error) {
		status = models.ProcessingStatusRateLimited
	} else {
		status = models.ProcessingStatusFailed
	}

	if result.Error != nil {
		errorMsg = result.Error.Error()
	}

	// Update database status
	if databaseURL != "" {
		db, dbErr := NewPostgresDB(ctx, databaseURL)
		if dbErr != nil {
			log.Printf("Warning: failed to connect to database: %v", dbErr)
		} else {
			defer db.Close()
			if updateErr := db.UpdateFilingDownloadFull(ctx, filing.SourceID, result.LocalPath, result.S3Key, status, errorMsg); updateErr != nil {
				log.Printf("Warning: failed to update filing status: %v", updateErr)
			}
		}
	}

	// Build output
	output := &DownloadResult{
		SourceID: payload.SourceID,
		Success:  result.Success,
		S3Key:    result.S3Key,
		FileSize: result.FileSize,
	}
	if result.Error != nil {
		output.Error = result.Error.Error()
	}

	log.Printf("Download complete: source_id=%s success=%v s3_key=%s duration=%s",
		payload.SourceID, result.Success, result.S3Key, result.Duration)

	return output, nil
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
