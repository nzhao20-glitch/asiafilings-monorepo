package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/database"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/scraper"
	"github.com/nicholaszhao/hkex-scraper/services/scraper/api"
)

func main() {
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
	client := api.NewClient(cfg)

	// Initialize database
	var db *database.DB
	var err error

	log.Printf("Initializing database: %s", cfg.DatabaseURL)
	db, err = database.New(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()
	log.Println("Database initialized successfully")

	// Run the scraper (metadata only, no downloads)
	s := scraper.New(cfg, client, nil, db)
	result, err := s.Run(ctx)
	if err != nil {
		log.Fatalf("Scraper error: %v", err)
	}

	// Print summary
	fmt.Println()
	fmt.Println("=== Scraping Complete ===")
	fmt.Printf("Total announcements: %d\n", result.TotalAnnouncements)
	fmt.Printf("New filings:         %d\n", result.NewFilings)
	fmt.Printf("Updated filings:     %d\n", result.UpdatedFilings)
	fmt.Printf("Errors:              %d\n", result.Errors)

	// Show database stats
	count, err := db.CountFilings(ctx)
	if err == nil {
		fmt.Printf("Total filings in DB: %d\n", count)
	}

	// Show pending downloads
	pending, err := db.CountFilingsByStatus(ctx, models.ProcessingStatusPending)
	if err == nil && pending > 0 {
		fmt.Printf("\nPending downloads: %d\n", pending)
		fmt.Println("Run 'hkex-downloader' to download PDFs")
	}
}
