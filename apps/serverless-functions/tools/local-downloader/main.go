package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/database"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/downloader"
)

func main() {
	// Parse command line flags
	limit := flag.Int("limit", 100, "Maximum number of files to download")
	concurrency := flag.Int("concurrency", 10, "Number of concurrent downloads")
	outputDir := flag.String("output", "./downloads", "Output directory for downloaded files")
	s3Bucket := flag.String("s3-bucket", "", "S3 bucket for uploads (optional)")
	dryRun := flag.Bool("dry-run", false, "Preview only, don't download files")
	proxyURL := flag.String("proxy", "", "FireProx proxy URL (optional)")
	timeout := flag.Duration("timeout", 30*time.Second, "HTTP request timeout")
	flag.Parse()

	// Print banner
	fmt.Println("HKEX Document Downloader (Local)")
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

	// Load config
	cfg := config.Load()

	// Initialize database
	log.Printf("Connecting to database: %s", cfg.DatabaseURL)
	db, err := database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer db.Close()

	// Create downloader config
	dlConfig := downloader.Config{
		Concurrency:   *concurrency,
		LocalPath:     *outputDir,
		S3Bucket:      *s3Bucket,
		DryRun:        *dryRun,
		ProxyBaseURL:  *proxyURL,
		Timeout:       *timeout,
		RetryAttempts: 3,
		RetryDelay:    1 * time.Second,
	}

	// Create downloader
	dl := downloader.New(dlConfig)

	// Set up S3 client if bucket specified
	if *s3Bucket != "" && !*dryRun {
		s3Client, err := downloader.NewS3Client(ctx)
		if err != nil {
			log.Fatalf("Failed to create S3 client: %v", err)
		}
		dl.SetS3Client(s3Client)
		log.Printf("S3 uploads enabled: %s", *s3Bucket)
	}

	// Create store and batch downloader
	store := downloader.NewDBStore(db)
	batchDl := downloader.NewBatchDownloader(dl, store)

	// Print config
	fmt.Printf("Configuration:\n")
	fmt.Printf("  Output directory: %s\n", *outputDir)
	fmt.Printf("  Concurrency:      %d\n", *concurrency)
	fmt.Printf("  Limit:            %d\n", *limit)
	fmt.Printf("  Dry run:          %v\n", *dryRun)
	if *proxyURL != "" {
		fmt.Printf("  Proxy URL:        %s\n", *proxyURL)
	}
	fmt.Println()

	// Get pending filings
	log.Printf("Fetching up to %d pending filings...", *limit)
	filings, err := store.GetPendingFilings(ctx, *limit)
	if err != nil {
		log.Fatalf("Failed to fetch pending filings: %v", err)
	}

	if len(filings) == 0 {
		fmt.Println("No pending filings to download.")
		return
	}

	log.Printf("Found %d pending filings", len(filings))

	// Create output directory if needed
	if !*dryRun && *outputDir != "" {
		if err := os.MkdirAll(*outputDir, 0755); err != nil {
			log.Fatalf("Failed to create output directory: %v", err)
		}
	}

	// Download with progress reporting
	startTime := time.Now()
	result := batchDl.DownloadBatchWithProgress(ctx, filings, func(current, total int, r *downloader.Result) {
		status := "OK"
		if !r.Success {
			status = "FAILED"
			if r.Error != nil {
				status = fmt.Sprintf("FAILED: %v", r.Error)
			}
		}
		log.Printf("[%d/%d] %s - %s", current, total, r.FilingID, status)
	})

	// Update database with results
	for _, r := range result.Results {
		var status models.ProcessingStatus
		var errorMsg string

		if r.Success {
			status = models.ProcessingStatusCompleted
		} else {
			status = models.ProcessingStatusFailed
			if r.Error != nil {
				errorMsg = r.Error.Error()
			}
		}

		if err := db.UpdateFilingDownloadFull(ctx, r.FilingID, r.LocalPath, r.S3Key, status, errorMsg); err != nil {
			log.Printf("Warning: failed to update filing %s: %v", r.FilingID, err)
		}
	}

	// Print summary
	fmt.Println()
	fmt.Println("=== Download Complete ===")
	fmt.Printf("Total:      %d\n", result.Total)
	fmt.Printf("Successful: %d\n", result.Successful)
	fmt.Printf("Failed:     %d\n", result.Failed)
	fmt.Printf("Duration:   %s\n", time.Since(startTime).Round(time.Second))

	if result.Successful > 0 {
		avgTime := result.Duration / time.Duration(result.Successful)
		fmt.Printf("Avg time:   %s per file\n", avgTime.Round(time.Millisecond))
	}

	// Print failed files
	if result.Failed > 0 {
		fmt.Println("\nFailed downloads:")
		for _, r := range result.Results {
			if !r.Success {
				fmt.Printf("  - %s: %v\n", r.FilingID, r.Error)
			}
		}
	}
}
