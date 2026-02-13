package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/scraper/api"
)

// ScraperInput is the input for the scraper Lambda
type ScraperInput struct {
	MaxPages int `json:"max_pages,omitempty"` // Override default max pages (optional)
}

// ScraperOutput is the output for Step Functions
type ScraperOutput struct {
	TotalAnnouncements int      `json:"total_announcements"`
	NewFilings         int      `json:"new_filings"`
	UpdatedFilings     int      `json:"updated_filings"`
	Errors             int      `json:"errors"`
	FilingIDs          []string `json:"filing_ids"` // IDs of new filings for downstream processing
}

// Handler is the Lambda handler function
func Handler(ctx context.Context, input ScraperInput) (*ScraperOutput, error) {
	log.Println("Starting HKEX Scraper Lambda...")

	// Load config
	cfg := config.Load()

	// Override max pages if specified
	if input.MaxPages > 0 {
		cfg.MaxPages = input.MaxPages
	}

	// Connect to PostgreSQL
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable not set")
	}

	db, err := NewPostgresDB(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	defer db.Close()

	log.Println("Database connected")

	// Create API client
	client := api.NewClient(cfg)

	// Fetch announcements
	log.Printf("Fetching up to %d pages of announcements", cfg.MaxPages)

	var allAnnouncements []models.Announcement
	for page := 1; page <= cfg.MaxPages; page++ {
		log.Printf("Fetching page %d...", page)

		resp, err := client.FetchAnnouncements(page)
		if err != nil {
			log.Printf("Error fetching page %d: %v", page, err)
			continue
		}

		if len(resp.NewsInfoLst) == 0 {
			log.Printf("No more announcements on page %d, stopping", page)
			break
		}

		allAnnouncements = append(allAnnouncements, resp.NewsInfoLst...)
	}

	log.Printf("Found %d total announcements", len(allAnnouncements))

	// Process announcements and collect new filing IDs
	output := &ScraperOutput{
		TotalAnnouncements: len(allAnnouncements),
		FilingIDs:          make([]string, 0),
	}

	for i := range allAnnouncements {
		ann := &allAnnouncements[i]

		// Skip if no stock code
		if len(ann.Stock) == 0 {
			continue
		}

		stock := &ann.Stock[0]

		// Get or create company
		company, err := db.GetCompanyByStockCode(ctx, stock.SC)
		if err != nil {
			log.Printf("Error getting company %s: %v", stock.SC, err)
			output.Errors++
			continue
		}

		if company == nil {
			// Create new company
			company = models.StockToCompany(stock)
			if err := db.UpsertCompany(ctx, company); err != nil {
				log.Printf("Error creating company %s: %v", stock.SC, err)
				output.Errors++
				continue
			}
			log.Printf("Created company: %s (%s)", company.StockCode, company.CompanyName)
		}

		// Check if filing already exists
		sourceID := strconv.Itoa(ann.NewsID)
		existing, err := db.GetFilingBySourceID(ctx, "HKEX", sourceID)
		if err != nil {
			log.Printf("Error checking filing %s: %v", sourceID, err)
			output.Errors++
			continue
		}

		// Convert announcement to filing
		filing := models.AnnouncementToFiling(ann, company.ID)

		if existing != nil {
			// Update existing filing
			filing.ID = existing.ID
			filing.CreatedAt = existing.CreatedAt
			output.UpdatedFilings++
		} else {
			// New filing - track ID for downstream processing
			output.NewFilings++
			output.FilingIDs = append(output.FilingIDs, sourceID)
		}

		// Save filing
		if err := db.UpsertFiling(ctx, filing); err != nil {
			log.Printf("Error saving filing %s: %v", sourceID, err)
			output.Errors++
			continue
		}
	}

	log.Printf("Scraper complete: %d total, %d new, %d updated, %d errors",
		output.TotalAnnouncements, output.NewFilings, output.UpdatedFilings, output.Errors)

	return output, nil
}

func main() {
	lambda.Start(Handler)
}
