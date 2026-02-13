package scraper

import (
	"context"
	"fmt"
	"log"
	"strconv"

	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/database"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	"github.com/nicholaszhao/hkex-scraper/packages/go/storage"
	"github.com/nicholaszhao/hkex-scraper/services/scraper/api"
)

// Result holds the results of scraping
type Result struct {
	TotalAnnouncements int
	Downloaded         int
	Skipped            int
	Errors             int
	NewFilings         int
	UpdatedFilings     int
}

// Scraper orchestrates the scraping workflow
type Scraper struct {
	client  *api.Client
	config  *config.Config
	storage storage.Storage
	db      *database.DB
}

// New creates a new Scraper instance
func New(cfg *config.Config, client *api.Client, store storage.Storage, db *database.DB) *Scraper {
	return &Scraper{
		client:  client,
		config:  cfg,
		storage: store,
		db:      db,
	}
}

// Run executes the scraping workflow
func (s *Scraper) Run(ctx context.Context) (*Result, error) {
	result := &Result{}

	log.Println("Starting HKEX Scraper...")
	log.Printf("Fetching up to %d pages of announcements", s.config.MaxPages)

	var allAnnouncements []models.Announcement

	// Fetch all announcements
	for page := 1; page <= s.config.MaxPages; page++ {
		log.Printf("Fetching page %d...", page)

		resp, err := s.client.FetchAnnouncements(page)
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

	result.TotalAnnouncements = len(allAnnouncements)
	log.Printf("Found %d total announcements", result.TotalAnnouncements)

	// Process announcements
	for i := range allAnnouncements {
		ann := &allAnnouncements[i]

		// Save to database if enabled
		if s.db != nil {
			if err := s.persistAnnouncement(ctx, ann, result); err != nil {
				log.Printf("Error persisting announcement %d: %v", ann.NewsID, err)
			}
		}

		// Download document if enabled
		if s.config.DownloadPDFs && s.storage != nil {
			if err := s.downloadDocument(ctx, ann, result); err != nil {
				log.Printf("Error downloading announcement %d: %v", ann.NewsID, err)
			}
		}
	}

	return result, nil
}

// persistAnnouncement saves an announcement and its company to the database
func (s *Scraper) persistAnnouncement(ctx context.Context, ann *models.Announcement, result *Result) error {
	// Process each stock associated with this announcement
	if len(ann.Stock) == 0 {
		return nil
	}

	// Use the first stock as the primary company
	stock := &ann.Stock[0]

	// Get or create company
	company, err := s.db.GetCompanyByStockCode(ctx, stock.SC)
	if err != nil {
		return fmt.Errorf("getting company: %w", err)
	}

	if company == nil {
		// Create new company
		company = models.StockToCompany(stock)
		if err := s.db.UpsertCompany(ctx, company); err != nil {
			return fmt.Errorf("creating company: %w", err)
		}
		log.Printf("Created company: %s (%s)", company.StockCode, company.CompanyName)
	}

	// Check if filing already exists
	existing, err := s.db.GetFilingBySourceID(ctx, "HKEX", strconv.Itoa(ann.NewsID))
	if err != nil {
		return fmt.Errorf("checking existing filing: %w", err)
	}

	// Convert announcement to filing
	filing := models.AnnouncementToFiling(ann, company.ID)

	if existing != nil {
		// Update existing filing
		filing.ID = existing.ID
		filing.CreatedAt = existing.CreatedAt
		result.UpdatedFilings++
	} else {
		result.NewFilings++
	}

	// Save filing
	if err := s.db.UpsertFiling(ctx, filing); err != nil {
		return fmt.Errorf("saving filing: %w", err)
	}

	return nil
}

// downloadDocument downloads and stores a single document
func (s *Scraper) downloadDocument(ctx context.Context, ann *models.Announcement, result *Result) error {
	// Check if already exists
	exists, err := s.storage.Exists(ctx, ann)
	if err != nil {
		result.Errors++
		return fmt.Errorf("checking existence: %w", err)
	}
	if exists {
		result.Skipped++
		return nil
	}

	// Download the document
	data, err := s.client.DownloadDocument(ann)
	if err != nil {
		result.Errors++
		return fmt.Errorf("downloading: %w", err)
	}

	// Save to storage
	path, err := s.storage.Save(ctx, ann, data)
	if err != nil {
		result.Errors++
		return fmt.Errorf("saving: %w", err)
	}

	result.Downloaded++
	log.Printf("Downloaded: %s -> %s", ann.DocumentURL(), path)

	// Update filing with local path if database is enabled
	if s.db != nil {
		sourceID := strconv.Itoa(ann.NewsID)
		filing, _ := s.db.GetFilingBySourceID(ctx, "HKEX", sourceID)
		if filing != nil {
			filing.LocalPath = path
			filing.ProcessingStatus = models.ProcessingStatusCompleted
			s.db.UpsertFiling(ctx, filing)
		}
	}

	return nil
}

// GetAnnouncements fetches announcements without downloading
func (s *Scraper) GetAnnouncements(ctx context.Context) ([]models.Announcement, error) {
	var allAnnouncements []models.Announcement

	for page := 1; page <= s.config.MaxPages; page++ {
		resp, err := s.client.FetchAnnouncements(page)
		if err != nil {
			return nil, fmt.Errorf("fetching page %d: %w", page, err)
		}

		if len(resp.NewsInfoLst) == 0 {
			break
		}

		allAnnouncements = append(allAnnouncements, resp.NewsInfoLst...)
	}

	return allAnnouncements, nil
}
