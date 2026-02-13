package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// Client handles HTTP requests to HKEX API
type Client struct {
	httpClient *http.Client
	config     *config.Config
	lastReq    time.Time
}

// NewClient creates a new HKEX API client
func NewClient(cfg *config.Config) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		config: cfg,
	}
}

// FetchAnnouncements retrieves announcements from a specific page
func (c *Client) FetchAnnouncements(page int) (*models.AnnouncementResponse, error) {
	c.rateLimit()

	url := c.config.AnnouncementListURL(page)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("User-Agent", "HKEXScraper/1.0")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetching announcements: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	var result models.AnnouncementResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}

	return &result, nil
}

// DownloadDocument downloads a document and returns its content
func (c *Client) DownloadDocument(announcement *models.Announcement) ([]byte, error) {
	c.rateLimit()

	url := announcement.DocumentURL()

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("User-Agent", "HKEXScraper/1.0")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("downloading document: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	return io.ReadAll(resp.Body)
}

// rateLimit ensures we don't exceed the configured rate limit
func (c *Client) rateLimit() {
	if c.config.RateLimit <= 0 {
		return
	}

	minInterval := time.Second / time.Duration(c.config.RateLimit)
	elapsed := time.Since(c.lastReq)

	if elapsed < minInterval {
		time.Sleep(minInterval - elapsed)
	}

	c.lastReq = time.Now()
}
