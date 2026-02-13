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
	"github.com/nicholaszhao/hkex-scraper/services/scraper/api"
)

func main() {
	// Parse command line flags
	fromDate := flag.String("from", "", "Start date (YYYY-MM-DD)")
	toDate := flag.String("to", "", "End date (YYYY-MM-DD)")
	market := flag.String("market", "SEHK", "Market: SEHK or GEM")
	dryRun := flag.Bool("dry-run", false, "Don't save to database, just show what would be fetched")
	flag.Parse()

	// Validate dates
	if *fromDate == "" || *toDate == "" {
		fmt.Println("Usage: backfill -from YYYY-MM-DD -to YYYY-MM-DD [-market SEHK|GEM] [-dry-run]")
		fmt.Println("\nOptions:")
		fmt.Println("  -from       Start date (required)")
		fmt.Println("  -to         End date (required)")
		fmt.Println("  -market     Market: SEHK or GEM (default: SEHK)")
		fmt.Println("  -dry-run    Preview only, don't save to database")
		fmt.Println("\nExamples:")
		fmt.Println("  backfill -from 2020-01-01 -to 2020-12-31")
		fmt.Println("  backfill -from 2023-01-01 -to 2023-06-30 -market GEM")
		fmt.Println("\nNote: Use 'hkex-downloader' to download PDFs after backfill")
		os.Exit(1)
	}

	from, err := time.Parse("2006-01-02", *fromDate)
	if err != nil {
		log.Fatalf("Invalid from date: %v", err)
	}

	to, err := time.Parse("2006-01-02", *toDate)
	if err != nil {
		log.Fatalf("Invalid to date: %v", err)
	}

	if from.After(to) {
		log.Fatal("From date must be before to date")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Received shutdown signal, stopping...")
		cancel()
	}()

	cfg := config.Load()
	searchClient := api.NewSearchClient(cfg)

	// Initialize database
	var db *database.DB
	if !*dryRun {
		log.Printf("Initializing database: %s", cfg.DatabaseURL)
		db, err = database.New(cfg.DatabaseURL)
		if err != nil {
			log.Fatalf("Failed to initialize database: %v", err)
		}
		defer db.Close()
		log.Println("Database initialized successfully")
	}

	// Run backfill
	result, err := runBackfill(ctx, searchClient, db, from, to, *market, *dryRun)
	if err != nil {
		log.Fatalf("Backfill error: %v", err)
	}

	// Print summary
	fmt.Println()
	fmt.Println("=== Backfill Complete ===")
	fmt.Printf("Date range:      %s to %s\n", from.Format("2006-01-02"), to.Format("2006-01-02"))
	fmt.Printf("Market:          %s\n", *market)
	fmt.Printf("Total fetched:   %d\n", result.TotalFetched)
	fmt.Printf("New filings:     %d\n", result.NewFilings)
	fmt.Printf("Updated filings: %d\n", result.UpdatedFilings)
	fmt.Printf("New companies:   %d\n", result.NewCompanies)
	fmt.Printf("Errors:          %d\n", result.Errors)

	if db != nil {
		count, err := db.CountFilings(ctx)
		if err == nil {
			fmt.Printf("Total in DB:     %d\n", count)
		}

		// Show pending downloads
		pending, err := db.CountFilingsByStatus(ctx, models.ProcessingStatusPending)
		if err == nil && pending > 0 {
			fmt.Printf("\nPending downloads: %d\n", pending)
			fmt.Println("Run 'hkex-downloader' to download PDFs")
		}
	}
}

// BackfillResult holds the results of a backfill operation
type BackfillResult struct {
	TotalFetched   int
	NewFilings     int
	UpdatedFilings int
	NewCompanies   int
	Errors         int
}

func runBackfill(ctx context.Context, client *api.SearchClient, db *database.DB, from, to time.Time, market string, dryRun bool) (*BackfillResult, error) {
	result := &BackfillResult{}

	log.Printf("Starting backfill from %s to %s for market %s",
		from.Format("2006-01-02"), to.Format("2006-01-02"), market)

	// Process month by month with large rowRange to get all results
	current := from
	for current.Before(to) || current.Equal(to) {
		select {
		case <-ctx.Done():
			return result, ctx.Err()
		default:
		}

		// Calculate end of current month
		endOfMonth := time.Date(current.Year(), current.Month()+1, 0, 23, 59, 59, 0, current.Location())
		chunkEnd := endOfMonth
		if chunkEnd.After(to) {
			chunkEnd = to
		}

		log.Printf("Fetching %s %s to %s...",
			market, current.Format("2006-01"), chunkEnd.Format("2006-01-02"))

		params := api.SearchParams{
			FromDate: current,
			ToDate:   chunkEnd,
			Market:   market,
			Category: -2,
			RowRange: 50000, // Increased to handle high-volume months
			SortDir:  0,
		}

		results, err := client.SearchAll(params)
		if err != nil {
			log.Printf("Error fetching %s: %v", current.Format("2006-01"), err)
			result.Errors++
			// Continue to next month
			current = time.Date(current.Year(), current.Month()+1, 1, 0, 0, 0, 0, current.Location())
			continue
		}

		log.Printf("  Found %d announcements", len(results))
		result.TotalFetched += len(results)

		if !dryRun && db != nil {
			// Process and save results
			for _, r := range results {
				if err := processSearchResult(ctx, db, &r, result); err != nil {
					log.Printf("  Error processing %s: %v", r.NewsID, err)
					result.Errors++
				}
			}
		}

		// Move to next month
		current = time.Date(current.Year(), current.Month()+1, 1, 0, 0, 0, 0, current.Location())
	}

	return result, nil
}

func processSearchResult(ctx context.Context, db *database.DB, r *api.SearchResult, result *BackfillResult) error {
	// Skip if no stock code (some announcements are market-wide)
	if r.StockCode == "" {
		return nil
	}

	// Get or create company
	company, err := db.GetCompanyByStockCode(ctx, r.StockCode)
	if err != nil {
		return fmt.Errorf("getting company: %w", err)
	}

	if company == nil {
		// Create new company - use stock code as ID (not timestamp-based IDs)
		company = &models.Company{
			ID:          r.StockCode,
			StockCode:   r.StockCode,
			CompanyName: r.StockName,
			MarketType:  models.MarketTypeSEHK,
			Exchange:    "HKEX",
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		}

		// Check if name is English
		if models.IsEnglishText(r.StockName) {
			company.CompanyNameEn = r.StockName
		}

		if err := db.UpsertCompany(ctx, company); err != nil {
			return fmt.Errorf("creating company: %w", err)
		}
		result.NewCompanies++
	}

	// Check if filing already exists
	existing, err := db.GetFilingBySourceID(ctx, "HKEX", r.NewsID)
	if err != nil {
		return fmt.Errorf("checking existing filing: %w", err)
	}

	// Create filing from search result (with SourceURL for later download)
	filing := models.SearchResultToFiling(
		r.NewsID,
		r.Title,
		r.StockCode,
		r.StockName,
		r.DateTime,
		r.FileType,
		r.FileInfo,
		r.FileLink,
		r.LongText,
		company.ID,
	)

	if existing != nil {
		// Update existing filing
		filing.ID = existing.ID
		filing.CreatedAt = existing.CreatedAt
		// Preserve download status if already downloaded
		if existing.ProcessingStatus == models.ProcessingStatusCompleted {
			filing.ProcessingStatus = existing.ProcessingStatus
			filing.LocalPath = existing.LocalPath
		}
		result.UpdatedFilings++
	} else {
		result.NewFilings++
	}

	// Save filing
	if err := db.UpsertFiling(ctx, filing); err != nil {
		return fmt.Errorf("saving filing: %w", err)
	}

	return nil
}
