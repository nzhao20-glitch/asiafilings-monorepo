package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// FilingPayload matches the scraper output format (same as sfn-downloader)
type FilingPayload struct {
	SourceID      string `json:"source_id"`
	SourceURL     string `json:"source_url"`
	CompanyID     string `json:"company_id"`
	FileExtension string `json:"file_extension"`
	Exchange      string `json:"exchange"`
	ReportDate    string `json:"report_date"`
}

// Input is the Lambda event payload from Step Functions.
// WriteManifest receives { "filings": [...] } from the Payload mapping.
type Input struct {
	Filings []FilingPayload `json:"filings"`
}

// Output is returned to Step Functions
type Output struct {
	ManifestBucket string `json:"manifest_bucket"`
	ManifestKey    string `json:"manifest_key"`
	ArraySize      int    `json:"array_size"`
	TotalFilings   int    `json:"total_filings"`
	ChunkSize      int    `json:"chunk_size"`
}

func Handler(ctx context.Context, input Input) (*Output, error) {
	bucket := os.Getenv("S3_BUCKET")
	if bucket == "" {
		return nil, fmt.Errorf("S3_BUCKET environment variable is required")
	}

	chunkSize := 50
	if cs := os.Getenv("CHUNK_SIZE"); cs != "" {
		if parsed, err := strconv.Atoi(cs); err == nil && parsed > 0 {
			chunkSize = parsed
		}
	}

	filings := input.Filings
	totalFilings := len(filings)

	if totalFilings == 0 {
		return nil, fmt.Errorf("no filings to write")
	}

	log.Printf("Writing manifest for %d filings (chunk_size=%d)", totalFilings, chunkSize)

	// Build JSONL content (one FilingPayload per line)
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	for _, f := range filings {
		if err := encoder.Encode(f); err != nil {
			return nil, fmt.Errorf("encoding filing %s: %w", f.SourceID, err)
		}
	}

	// Generate manifest key with timestamp
	manifestKey := fmt.Sprintf("manifests/%s.jsonl", time.Now().UTC().Format("20060102T150405Z"))

	// Upload to S3
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}
	s3Client := s3.NewFromConfig(cfg)

	_, err = s3Client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(manifestKey),
		Body:        bytes.NewReader(buf.Bytes()),
		ContentType: aws.String("application/x-ndjson"),
	})
	if err != nil {
		return nil, fmt.Errorf("uploading manifest to S3: %w", err)
	}

	arraySize := int(math.Ceil(float64(totalFilings) / float64(chunkSize)))

	log.Printf("Manifest written: s3://%s/%s (%d filings, %d chunks)", bucket, manifestKey, totalFilings, arraySize)

	return &Output{
		ManifestBucket: bucket,
		ManifestKey:    manifestKey,
		ArraySize:      arraySize,
		TotalFilings:   totalFilings,
		ChunkSize:      chunkSize,
	}, nil
}

func main() {
	lambda.Start(Handler)
}
