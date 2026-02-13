package downloader

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// BatchResult contains the results of a batch download
type BatchResult struct {
	Total      int
	Successful int
	Failed     int
	Results    []*Result
	Duration   time.Duration
}

// FilingStore interface for database operations
type FilingStore interface {
	GetFilingsByIDs(ctx context.Context, ids []string) ([]models.Filing, error)
	UpdateFilingDownload(ctx context.Context, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error
	SetProcessing(ctx context.Context, filingID string) error
}

// BatchDownloader handles batch downloads with concurrency control
type BatchDownloader struct {
	downloader *Downloader
	store      FilingStore
}

// NewBatchDownloader creates a new batch downloader
func NewBatchDownloader(downloader *Downloader, store FilingStore) *BatchDownloader {
	return &BatchDownloader{
		downloader: downloader,
		store:      store,
	}
}

// DownloadBatch downloads multiple filings concurrently
func (b *BatchDownloader) DownloadBatch(ctx context.Context, filings []models.Filing) *BatchResult {
	start := time.Now()
	result := &BatchResult{
		Total:   len(filings),
		Results: make([]*Result, 0, len(filings)),
	}

	if len(filings) == 0 {
		result.Duration = time.Since(start)
		return result
	}

	// Create channels for work distribution
	jobs := make(chan *models.Filing, len(filings))
	results := make(chan *Result, len(filings))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < b.downloader.config.Concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for filing := range jobs {
				select {
				case <-ctx.Done():
					results <- &Result{
						FilingID: filing.ID,
						Error:    ctx.Err(),
					}
				default:
					r := b.downloader.Download(ctx, filing)
					results <- r
				}
			}
		}(i)
	}

	// Send jobs to workers
	go func() {
		for i := range filings {
			jobs <- &filings[i]
		}
		close(jobs)
	}()

	// Wait for all workers to complete and close results channel
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	for r := range results {
		result.Results = append(result.Results, r)
		if r.Success {
			result.Successful++
		} else {
			result.Failed++
		}
	}

	result.Duration = time.Since(start)
	return result
}

// DownloadBatchByIDs fetches filings from the store and downloads them
// Uses proper status management: PENDING -> PROCESSING -> COMPLETED/FAILED
func (b *BatchDownloader) DownloadBatchByIDs(ctx context.Context, filingIDs []string) (*BatchResult, error) {
	if b.store == nil {
		return nil, fmt.Errorf("filing store not configured")
	}

	// Fetch filings from database
	filings, err := b.store.GetFilingsByIDs(ctx, filingIDs)
	if err != nil {
		return nil, fmt.Errorf("fetching filings: %w", err)
	}

	// Filter out already completed filings (idempotency)
	// Allow retrying RATE_LIMITED filings
	var pendingFilings []models.Filing
	for _, f := range filings {
		if f.ProcessingStatus == models.ProcessingStatusCompleted {
			log.Printf("Skipping already completed filing %s", f.ID)
			continue
		}
		// Skip permanent failures (URL_FAILURE = 404)
		if f.ProcessingStatus == models.ProcessingStatusURLFailure {
			log.Printf("Skipping URL failure filing %s", f.ID)
			continue
		}
		// Also skip if S3 key already exists
		if f.PDFS3Key != "" {
			log.Printf("Skipping filing %s - already has S3 key: %s", f.ID, f.PDFS3Key)
			continue
		}
		pendingFilings = append(pendingFilings, f)
	}

	if len(pendingFilings) == 0 {
		log.Printf("All %d filings already completed or have S3 keys", len(filings))
		return &BatchResult{
			Total:      len(filings),
			Successful: len(filings),
		}, nil
	}

	log.Printf("Processing %d filings (%d skipped as already complete)", len(pendingFilings), len(filings)-len(pendingFilings))

	// Mark all as PROCESSING before starting downloads
	for _, f := range pendingFilings {
		if err := b.store.SetProcessing(ctx, f.ID); err != nil {
			log.Printf("Failed to set PROCESSING for filing %s: %v", f.ID, err)
		}
	}

	// Download batch with immediate status updates
	result := b.DownloadBatchWithStatusUpdates(ctx, pendingFilings)

	return result, nil
}

// DownloadBatchWithStatusUpdates downloads files and updates DB immediately after each one
func (b *BatchDownloader) DownloadBatchWithStatusUpdates(ctx context.Context, filings []models.Filing) *BatchResult {
	start := time.Now()
	result := &BatchResult{
		Total:   len(filings),
		Results: make([]*Result, 0, len(filings)),
	}

	if len(filings) == 0 {
		result.Duration = time.Since(start)
		return result
	}

	// Create channels for work distribution
	jobs := make(chan *models.Filing, len(filings))
	results := make(chan *Result, len(filings))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < b.downloader.config.Concurrency; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			for filing := range jobs {
				var r *Result
				select {
				case <-ctx.Done():
					r = &Result{
						FilingID: filing.ID,
						Error:    ctx.Err(),
					}
				default:
					r = b.downloader.Download(ctx, filing)
				}

				// Update database IMMEDIATELY after each download
				var status models.ProcessingStatus
				var errorMsg string

				if r.Success {
					status = models.ProcessingStatusCompleted
				} else {
					// Check if it's a URL not found error (404) - permanent failure
					if IsURLNotFoundError(r.Error) {
						status = models.ProcessingStatusURLFailure
					} else if IsRateLimitError(r.Error) {
						// Rate limited (403/429) - can retry later
						status = models.ProcessingStatusRateLimited
					} else {
						status = models.ProcessingStatusFailed
					}
					if r.Error != nil {
						errorMsg = r.Error.Error()
					}
				}

				if err := b.store.UpdateFilingDownload(ctx, r.FilingID, r.LocalPath, r.S3Key, status, errorMsg); err != nil {
					log.Printf("Failed to update filing %s: %v", r.FilingID, err)
				}

				results <- r
			}
		}(i)
	}

	// Send jobs to workers
	go func() {
		for i := range filings {
			jobs <- &filings[i]
		}
		close(jobs)
	}()

	// Wait for all workers to complete and close results channel
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	for r := range results {
		result.Results = append(result.Results, r)
		if r.Success {
			result.Successful++
		} else {
			result.Failed++
		}
	}

	result.Duration = time.Since(start)
	return result
}

// ProgressCallback is called after each download completes
type ProgressCallback func(current, total int, result *Result)

// DownloadBatchWithProgress downloads with progress reporting
func (b *BatchDownloader) DownloadBatchWithProgress(ctx context.Context, filings []models.Filing, callback ProgressCallback) *BatchResult {
	start := time.Now()
	result := &BatchResult{
		Total:   len(filings),
		Results: make([]*Result, 0, len(filings)),
	}

	if len(filings) == 0 {
		result.Duration = time.Since(start)
		return result
	}

	// Create channels
	jobs := make(chan *models.Filing, len(filings))
	results := make(chan *Result, len(filings))

	// Start workers
	var wg sync.WaitGroup
	for i := 0; i < b.downloader.config.Concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for filing := range jobs {
				select {
				case <-ctx.Done():
					results <- &Result{
						FilingID: filing.ID,
						Error:    ctx.Err(),
					}
				default:
					r := b.downloader.Download(ctx, filing)
					results <- r
				}
			}
		}()
	}

	// Send jobs
	go func() {
		for i := range filings {
			jobs <- &filings[i]
		}
		close(jobs)
	}()

	// Close results when done
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results with progress
	completed := 0
	for r := range results {
		completed++
		result.Results = append(result.Results, r)
		if r.Success {
			result.Successful++
		} else {
			result.Failed++
		}

		if callback != nil {
			callback(completed, result.Total, r)
		}
	}

	result.Duration = time.Since(start)
	return result
}
