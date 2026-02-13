package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BatchJob represents a batch of filing IDs to process
type BatchJob struct {
	FilingIDs []string `json:"filing_ids"`
}

// Mode constants
const (
	ModeDownload   = "download"
	ModeExtraction = "extraction"
	ModeIndexing   = "indexing"
)

func main() {
	// Parse command line flags
	mode := flag.String("mode", ModeDownload, "Job mode: 'download', 'extraction', or 'indexing'")
	batchSize := flag.Int("batch-size", 0, "Number of filings per SQS message (default: 100 for download, 50 for extraction)")
	limit := flag.Int("limit", 0, "Maximum number of filings to queue (0 = all pending)")
	queueURL := flag.String("queue-url", "", "SQS queue URL (required)")
	databaseURL := flag.String("database-url", "", "PostgreSQL connection string (or use DATABASE_URL env)")
	dryRun := flag.Bool("dry-run", false, "Preview only, don't push to SQS")
	documentType := flag.String("document-type", "PDF", "Document type to filter: 'PDF', 'HTML', 'EXCEL', 'WORD', 'TEXT', 'OTHER', or 'ALL'")
	exchange := flag.String("exchange", "ALL", "Exchange to filter: 'HKEX', 'DART', or 'ALL'")
	flag.Parse()

	// Validate mode
	if *mode != ModeDownload && *mode != ModeExtraction && *mode != ModeIndexing {
		fmt.Printf("Error: invalid mode '%s'. Use 'download', 'extraction', or 'indexing'\n", *mode)
		os.Exit(1)
	}

	// Set default batch size based on mode
	if *batchSize == 0 {
		if *mode == ModeExtraction || *mode == ModeIndexing {
			*batchSize = 50 // Smaller batches for extraction/indexing (heavier processing)
		} else {
			*batchSize = 100
		}
	}

	// Validate required flags
	if *queueURL == "" {
		*queueURL = os.Getenv("SQS_QUEUE_URL")
	}
	if *queueURL == "" && !*dryRun {
		fmt.Println("Error: -queue-url is required (or set SQS_QUEUE_URL)")
		flag.Usage()
		os.Exit(1)
	}

	if *databaseURL == "" {
		*databaseURL = os.Getenv("DATABASE_URL")
	}
	if *databaseURL == "" {
		fmt.Println("Error: -database-url is required (or set DATABASE_URL)")
		flag.Usage()
		os.Exit(1)
	}

	fmt.Printf("HKEX Job Generator (%s mode)\n", *mode)
	fmt.Println("================================")
	fmt.Println()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("\nReceived shutdown signal, stopping...")
		cancel()
	}()

	// Connect to PostgreSQL
	log.Printf("Connecting to database...")
	pool, err := pgxpool.New(ctx, *databaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer pool.Close()

	// Test connection
	if err := pool.Ping(ctx); err != nil {
		log.Fatalf("Failed to ping database: %v", err)
	}
	log.Println("Database connected")

	// Build query based on mode
	var query string
	var args []interface{}

	if *mode == ModeExtraction {
		// Extraction mode: query completed downloads that need extraction
		// Filter by exchange and document_type
		exchangeFilter := "exchange IN ('HKEX', 'DART')"
		if *exchange != "ALL" {
			exchangeFilter = fmt.Sprintf("exchange = '%s'", *exchange)
		}

		docTypeFilter := ""
		if *documentType != "ALL" {
			docTypeFilter = fmt.Sprintf("AND document_type = '%s'", *documentType)
		}

		if *limit > 0 {
			query = fmt.Sprintf(`SELECT exchange || ':' || source_id FROM filings
				WHERE %s
				AND processing_status = 'COMPLETED'
				AND pdf_s3_key IS NOT NULL
				AND (extraction_status IS NULL OR extraction_status = 'PENDING')
				%s
				ORDER BY report_date DESC
				LIMIT $1`, exchangeFilter, docTypeFilter)
			args = []interface{}{*limit}
		} else {
			query = fmt.Sprintf(`SELECT exchange || ':' || source_id FROM filings
				WHERE %s
				AND processing_status = 'COMPLETED'
				AND pdf_s3_key IS NOT NULL
				AND (extraction_status IS NULL OR extraction_status = 'PENDING')
				%s
				ORDER BY report_date DESC`, exchangeFilter, docTypeFilter)
		}
		log.Printf("Querying filings pending extraction (exchange=%s, document_type=%s)...", *exchange, *documentType)
	} else if *mode == ModeIndexing {
		// Indexing mode: query completed downloads that need Meilisearch indexing
		// Filter by exchange and document_type
		exchangeFilter := "exchange IN ('HKEX', 'DART')"
		if *exchange != "ALL" {
			exchangeFilter = fmt.Sprintf("exchange = '%s'", *exchange)
		}

		docTypeFilter := ""
		if *documentType != "ALL" {
			docTypeFilter = fmt.Sprintf("AND document_type = '%s'", *documentType)
		}

		if *limit > 0 {
			query = fmt.Sprintf(`SELECT exchange || ':' || source_id FROM filings
				WHERE %s
				AND processing_status = 'COMPLETED'
				AND pdf_s3_key IS NOT NULL
				AND (indexing_status IS NULL OR indexing_status = 'PENDING')
				%s
				ORDER BY report_date DESC
				LIMIT $1`, exchangeFilter, docTypeFilter)
			args = []interface{}{*limit}
		} else {
			query = fmt.Sprintf(`SELECT exchange || ':' || source_id FROM filings
				WHERE %s
				AND processing_status = 'COMPLETED'
				AND pdf_s3_key IS NOT NULL
				AND (indexing_status IS NULL OR indexing_status = 'PENDING')
				%s
				ORDER BY report_date DESC`, exchangeFilter, docTypeFilter)
		}
		log.Printf("Querying filings pending indexing (exchange=%s, document_type=%s)...", *exchange, *documentType)
	} else {
		// Download mode: query pending downloads (Lambda expects source_id only)
		// Note: RDS has lowercase 'pending', SQLite has uppercase 'PENDING'
		if *limit > 0 {
			query = `SELECT source_id FROM filings
				WHERE exchange = 'HKEX' AND (processing_status = 'pending' OR processing_status = 'PENDING')
				ORDER BY report_date DESC LIMIT $1`
			args = []interface{}{*limit}
		} else {
			query = `SELECT source_id FROM filings
				WHERE exchange = 'HKEX' AND (processing_status = 'pending' OR processing_status = 'PENDING')
				ORDER BY report_date DESC`
		}
		log.Println("Querying filings pending download...")
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		log.Fatalf("Failed to query filings: %v", err)
	}

	var filingIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			log.Fatalf("Failed to scan filing ID: %v", err)
		}
		filingIDs = append(filingIDs, id)
	}
	rows.Close()

	if len(filingIDs) == 0 {
		switch *mode {
		case ModeExtraction:
			fmt.Println("No filings pending extraction.")
		case ModeIndexing:
			fmt.Println("No filings pending indexing.")
		default:
			fmt.Println("No filings pending download.")
		}
		return
	}

	log.Printf("Found %d filings to process", len(filingIDs))

	// Create SQS client
	var sqsClient *sqs.Client
	if !*dryRun {
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			log.Fatalf("Failed to load AWS config: %v", err)
		}
		sqsClient = sqs.NewFromConfig(cfg)
	}

	// Group into batches and push to SQS
	totalBatches := (len(filingIDs) + *batchSize - 1) / *batchSize
	log.Printf("Creating %d batches of %d filings each", totalBatches, *batchSize)

	sentMessages := 0
	for i := 0; i < len(filingIDs); i += *batchSize {
		select {
		case <-ctx.Done():
			log.Printf("Interrupted after %d messages", sentMessages)
			return
		default:
		}

		end := i + *batchSize
		if end > len(filingIDs) {
			end = len(filingIDs)
		}

		batch := filingIDs[i:end]
		job := BatchJob{FilingIDs: batch}

		jobJSON, err := json.Marshal(job)
		if err != nil {
			log.Printf("Error marshaling batch %d: %v", i / *batchSize, err)
			continue
		}

		if *dryRun {
			log.Printf("Batch %d: %d filings (dry-run)", i / *batchSize + 1, len(batch))
		} else {
			_, err = sqsClient.SendMessage(ctx, &sqs.SendMessageInput{
				QueueUrl:    queueURL,
				MessageBody: aws.String(string(jobJSON)),
			})
			if err != nil {
				log.Printf("Error sending batch %d: %v", i / *batchSize + 1, err)
				continue
			}
			log.Printf("Batch %d: %d filings sent", i / *batchSize + 1, len(batch))
		}

		sentMessages++
	}

	// Print summary
	fmt.Println()
	fmt.Println("=== Job Generation Complete ===")
	fmt.Printf("Mode:           %s\n", *mode)
	fmt.Printf("Total filings:  %d\n", len(filingIDs))
	fmt.Printf("Batch size:     %d\n", *batchSize)
	fmt.Printf("Messages sent:  %d\n", sentMessages)
	if *dryRun {
		fmt.Println("\n(dry-run mode - no messages were actually sent)")
	}
}
