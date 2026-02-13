package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sns"
)

// NotifyInput is the workflow summary from Step Functions
type NotifyInput struct {
	// Scraper results
	TotalAnnouncements int `json:"total_announcements"`
	NewFilings         int `json:"new_filings"`
	UpdatedFilings     int `json:"updated_filings"`

	// Download results
	DownloadBatchesSent int `json:"download_batches_sent"`
	DownloadsQueued     int `json:"downloads_queued"`

	// Extraction results
	ExtractionBatchesSent int `json:"extraction_batches_sent"`
	ExtractionsQueued     int `json:"extractions_queued"`

	// Final status
	Status string `json:"status"` // SUCCESS, PARTIAL_FAILURE, FAILED
	Error  string `json:"error,omitempty"`
}

// NotifyOutput is the result of the notification
type NotifyOutput struct {
	MessageID string `json:"message_id"`
	Sent      bool   `json:"sent"`
}

func Handler(ctx context.Context, input NotifyInput) (*NotifyOutput, error) {
	log.Println("Sending workflow notification...")

	topicARN := os.Getenv("SNS_TOPIC_ARN")
	if topicARN == "" {
		log.Println("SNS_TOPIC_ARN not set, skipping notification")
		return &NotifyOutput{Sent: false}, nil
	}

	// Build notification message
	status := input.Status
	if status == "" {
		status = "SUCCESS"
	}

	subject := fmt.Sprintf("HKEX Scraper Daily Run - %s", status)

	message := fmt.Sprintf(`HKEX Scraper Daily Workflow Complete
=====================================
Date: %s
Status: %s

Scraper Results:
  Total Announcements: %d
  New Filings: %d
  Updated Filings: %d

Download Queue:
  Batches Sent: %d
  Filings Queued: %d

Extraction Queue:
  Batches Sent: %d
  Filings Queued: %d
`,
		time.Now().Format("2006-01-02 15:04:05 MST"),
		status,
		input.TotalAnnouncements,
		input.NewFilings,
		input.UpdatedFilings,
		input.DownloadBatchesSent,
		input.DownloadsQueued,
		input.ExtractionBatchesSent,
		input.ExtractionsQueued,
	)

	if input.Error != "" {
		message += fmt.Sprintf("\nError Details:\n%s\n", input.Error)
	}

	// Create SNS client and send message
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	snsClient := sns.NewFromConfig(cfg)

	result, err := snsClient.Publish(ctx, &sns.PublishInput{
		TopicArn: aws.String(topicARN),
		Subject:  aws.String(subject),
		Message:  aws.String(message),
	})
	if err != nil {
		return nil, fmt.Errorf("publishing to SNS: %w", err)
	}

	log.Printf("Notification sent: %s", *result.MessageId)

	return &NotifyOutput{
		MessageID: *result.MessageId,
		Sent:      true,
	}, nil
}

func main() {
	lambda.Start(Handler)
}
