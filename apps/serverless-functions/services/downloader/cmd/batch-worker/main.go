package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/downloader"
)

// FilingPayload matches the manifest JSONL format (same as sfn-downloader)
type FilingPayload struct {
	SourceID      string `json:"source_id"`
	SourceURL     string `json:"source_url"`
	CompanyID     string `json:"company_id"`
	FileExtension string `json:"file_extension"`
	Exchange      string `json:"exchange"`
	ReportDate    string `json:"report_date"`
}

func main() {
	ctx := context.Background()

	// Load configuration from environment
	manifestBucket := requireEnv("MANIFEST_BUCKET")
	manifestKey := requireEnv("MANIFEST_KEY")
	s3Bucket := requireEnv("S3_BUCKET")
	databaseURL := os.Getenv("DATABASE_URL")
	proxyBaseURL := os.Getenv("PROXY_BASE_URL")

	chunkSize := getEnvInt("CHUNK_SIZE", 50)
	arrayIndex := getEnvInt("AWS_BATCH_JOB_ARRAY_INDEX", 0)
	jobID := os.Getenv("AWS_BATCH_JOB_ID")

	log.Printf("Batch worker starting: job_id=%s array_index=%d chunk_size=%d", jobID, arrayIndex, chunkSize)
	log.Printf("Manifest: s3://%s/%s", manifestBucket, manifestKey)

	// Read manifest from S3
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatalf("Failed to load AWS config: %v", err)
	}
	s3Client := s3.NewFromConfig(cfg)

	resp, err := s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(manifestBucket),
		Key:    aws.String(manifestKey),
	})
	if err != nil {
		log.Fatalf("Failed to read manifest from S3: %v", err)
	}
	defer resp.Body.Close()

	// Parse the chunk for this array index
	filings, err := readChunk(resp.Body, arrayIndex, chunkSize)
	if err != nil {
		log.Fatalf("Failed to read chunk: %v", err)
	}

	if len(filings) == 0 {
		log.Printf("No filings in chunk %d, exiting", arrayIndex)
		return
	}

	log.Printf("Processing %d filings in chunk %d", len(filings), arrayIndex)

	// Create downloader with worker pool concurrency
	dlConfig := downloader.Config{
		Concurrency:     5,
		S3Bucket:        s3Bucket,
		ProxyBaseURL:    proxyBaseURL,
		Timeout:         30 * time.Second,
		RetryAttempts:   3,
		RetryDelay:      5 * time.Second,
		MinRequestDelay: 500 * time.Millisecond,
		MaxRequestDelay: 2 * time.Second,
	}
	dl := downloader.New(dlConfig)

	// Create S3 uploader client
	uploaderClient, err := downloader.NewS3Client(ctx)
	if err != nil {
		log.Fatalf("Failed to create S3 uploader client: %v", err)
	}
	dl.SetS3Client(uploaderClient)

	// Connect to database if configured
	var db *PostgresDB
	if databaseURL != "" {
		db, err = NewPostgresDB(ctx, databaseURL)
		if err != nil {
			log.Printf("Warning: failed to connect to database: %v", err)
		} else {
			defer db.Close()
		}
	}

	// Process filings using the batch downloader's worker pool pattern
	modelFilings := make([]models.Filing, len(filings))
	for i, fp := range filings {
		reportDate, parseErr := time.Parse(time.RFC3339, fp.ReportDate)
		if parseErr != nil {
			log.Printf("Warning: invalid report_date %q for %s, using current time", fp.ReportDate, fp.SourceID)
			reportDate = time.Now()
		}

		modelFilings[i] = models.Filing{
			ID:            fp.SourceID,
			SourceID:      fp.SourceID,
			SourceURL:     fp.SourceURL,
			CompanyID:     fp.CompanyID,
			FileExtension: fp.FileExtension,
			Exchange:      fp.Exchange,
			ReportDate:    reportDate,
		}
	}

	// Build lookup map from SourceID → Exchange for DB updates
	exchangeByID := make(map[string]string, len(filings))
	for _, fp := range filings {
		exchangeByID[fp.SourceID] = fp.Exchange
	}

	// Use BatchDownloader for concurrent processing with status updates
	batchDl := downloader.NewBatchDownloader(dl, nil)
	start := time.Now()

	result := batchDl.DownloadBatch(ctx, modelFilings)

	// Update database for each result
	if db != nil {
		for _, r := range result.Results {
			var status models.ProcessingStatus
			var errorMsg string

			if r.Success {
				status = models.ProcessingStatusCompleted
			} else if downloader.IsURLNotFoundError(r.Error) {
				status = models.ProcessingStatusURLFailure
			} else if downloader.IsRateLimitError(r.Error) {
				status = models.ProcessingStatusRateLimited
			} else {
				status = models.ProcessingStatusFailed
			}

			if r.Error != nil {
				errorMsg = r.Error.Error()
			}

			exchange := exchangeByID[r.FilingID]
			if exchange == "" {
				exchange = "HKEX"
			}

			if updateErr := db.UpdateFilingDownloadFull(ctx, exchange, r.FilingID, r.LocalPath, r.S3Key, status, errorMsg); updateErr != nil {
				log.Printf("Warning: failed to update filing %s: %v", r.FilingID, updateErr)
			}
		}
	}

	duration := time.Since(start)
	log.Printf("Batch complete: total=%d success=%d failed=%d duration=%s",
		result.Total, result.Successful, result.Failed, duration)

	if result.Failed > 0 {
		log.Printf("Warning: %d filings failed to download", result.Failed)
	}
}

// readChunk reads the manifest JSONL and extracts the chunk for the given array index
func readChunk(reader io.Reader, arrayIndex, chunkSize int) ([]FilingPayload, error) {
	scanner := bufio.NewScanner(reader)
	// Increase scanner buffer for large lines
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	startLine := arrayIndex * chunkSize
	endLine := startLine + chunkSize

	var filings []FilingPayload
	lineNum := 0

	for scanner.Scan() {
		if lineNum >= endLine {
			break
		}
		if lineNum >= startLine {
			var fp FilingPayload
			if err := json.Unmarshal(scanner.Bytes(), &fp); err != nil {
				return nil, fmt.Errorf("parsing line %d: %w", lineNum, err)
			}
			filings = append(filings, fp)
		}
		lineNum++
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading manifest: %w", err)
	}

	return filings, nil
}

func requireEnv(key string) string {
	val := os.Getenv(key)
	if val == "" {
		log.Fatalf("Required environment variable %s is not set", key)
	}
	return val
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if parsed, err := strconv.Atoi(val); err == nil {
			return parsed
		}
	}
	return defaultVal
}
