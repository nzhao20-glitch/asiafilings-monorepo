package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/services/scraper/api"
)

// ScraperInput is the input for the scraper Lambda.
// For daily scheduled runs, omit dates to query the last 24 hours.
// For historical backfills, provide start_date and end_date in YYYY-MM-DD format.
type ScraperInput struct {
	StartDate string `json:"start_date,omitempty"` // YYYY-MM-DD (default: 24 hours ago)
	EndDate   string `json:"end_date,omitempty"`   // YYYY-MM-DD (default: now)
	Market    string `json:"market,omitempty"`      // SEHK, GEM, or empty for SEHK (default)
}

// FilingPayload is the metadata passed to the downloader via Step Functions Map state.
// Contains everything the downloader needs to download a filing without querying the DB.
type FilingPayload struct {
	SourceID      string `json:"source_id"`
	SourceURL     string `json:"source_url"`
	CompanyID     string `json:"company_id"`
	FileExtension string `json:"file_extension"`
	Exchange      string `json:"exchange"`
	ReportDate    string `json:"report_date"` // RFC3339
}

// ScraperOutput is the output for Step Functions
type ScraperOutput struct {
	TotalAnnouncements int             `json:"total_announcements"`
	NewFilings         int             `json:"new_filings"`
	UpdatedFilings     int             `json:"updated_filings"`
	Errors             int             `json:"errors"`
	Filings            []FilingPayload `json:"filings"` // New filings for downstream Map state
}

// Handler is the Lambda handler function
func Handler(ctx context.Context, input ScraperInput) (*ScraperOutput, error) {
	log.Println("Starting HKEX Scraper Lambda...")

	// Load config
	cfg := config.Load()

	// Determine date range (HKT = UTC+8)
	hkt := time.FixedZone("HKT", 8*3600)
	now := time.Now().In(hkt)

	var startDate, endDate time.Time

	if input.StartDate != "" {
		var err error
		startDate, err = time.ParseInLocation("2006-01-02", input.StartDate, hkt)
		if err != nil {
			return nil, fmt.Errorf("invalid start_date %q: %w", input.StartDate, err)
		}
	} else {
		// Default: last 24 hours
		startDate = now.Add(-24 * time.Hour)
	}

	if input.EndDate != "" {
		var err error
		endDate, err = time.ParseInLocation("2006-01-02", input.EndDate, hkt)
		if err != nil {
			return nil, fmt.Errorf("invalid end_date %q: %w", input.EndDate, err)
		}
		// Set to end of day
		endDate = endDate.Add(23*time.Hour + 59*time.Minute + 59*time.Second)
	} else {
		endDate = now
	}

	market := input.Market
	if market == "" {
		market = "SEHK"
	}

	log.Printf("Querying HKEX Search API: %s to %s (market: %s)",
		startDate.Format("2006-01-02 15:04"), endDate.Format("2006-01-02 15:04"), market)

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

	// Create Search API client and fetch announcements by date range
	searchClient := api.NewSearchClient(cfg)

	results, err := searchClient.SearchByDateRange(startDate, endDate, market)
	if err != nil {
		return nil, fmt.Errorf("searching HKEX: %w", err)
	}

	log.Printf("Found %d announcements in date range", len(results))

	// Process results and collect new filing payloads for the Map state
	output := &ScraperOutput{
		TotalAnnouncements: len(results),
		Filings:            make([]FilingPayload, 0),
	}

	for i := range results {
		r := &results[i]

		if r.StockCode == "" {
			continue
		}

		// Get or create company
		company, err := db.GetCompanyByStockCode(ctx, r.StockCode)
		if err != nil {
			log.Printf("Error getting company %s: %v", r.StockCode, err)
			output.Errors++
			continue
		}

		if company == nil {
			company = &models.Company{
				ID:          r.StockCode,
				StockCode:   r.StockCode,
				CompanyName: r.StockName,
				MarketType:  models.MarketType(market),
				Exchange:    "HKEX",
			}
			if models.IsEnglishText(r.StockName) {
				company.CompanyNameEn = r.StockName
			}
			if err := db.UpsertCompany(ctx, company); err != nil {
				log.Printf("Error creating company %s: %v", r.StockCode, err)
				output.Errors++
				continue
			}
			log.Printf("Created company: %s (%s)", company.StockCode, company.CompanyName)
		}

		// Check if filing already exists
		existing, err := db.GetFilingBySourceID(ctx, "HKEX", r.NewsID)
		if err != nil {
			log.Printf("Error checking filing %s: %v", r.NewsID, err)
			output.Errors++
			continue
		}

		// Convert search result to filing
		filing := models.SearchResultToFiling(
			r.NewsID, r.Title, r.StockCode, r.StockName,
			r.DateTime, r.FileType, r.FileInfo, r.FileLink,
			r.LongText, company.ID,
		)

		if existing != nil {
			filing.ID = existing.ID
			filing.CreatedAt = existing.CreatedAt
			output.UpdatedFilings++
		} else {
			output.NewFilings++
			// Add to filings array for downstream Map state processing
			output.Filings = append(output.Filings, FilingPayload{
				SourceID:      r.NewsID,
				SourceURL:     filing.SourceURL,
				CompanyID:     company.ID,
				FileExtension: filing.FileExtension,
				Exchange:      "HKEX",
				ReportDate:    filing.ReportDate.Format(time.RFC3339),
			})
		}

		// Save filing
		if err := db.UpsertFiling(ctx, filing); err != nil {
			log.Printf("Error saving filing %s: %v", r.NewsID, err)
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
