package downloader

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// URLNotFoundError indicates the source URL returned 404 (file doesn't exist at source)
type URLNotFoundError struct {
	StatusCode int
	URL        string
}

func (e *URLNotFoundError) Error() string {
	return fmt.Sprintf("URL not found (404): %s", e.URL)
}

// IsURLNotFoundError checks if an error is a URLNotFoundError
func IsURLNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	// Check if the error itself is URLNotFoundError
	if _, ok := err.(*URLNotFoundError); ok {
		return true
	}
	// Check if wrapped error contains URLNotFoundError
	var urlErr *URLNotFoundError
	return errors.As(err, &urlErr)
}

// RateLimitError indicates rate limiting (403 or 429)
type RateLimitError struct {
	StatusCode int
	URL        string
}

func (e *RateLimitError) Error() string {
	return fmt.Sprintf("rate limited (%d): %s", e.StatusCode, e.URL)
}

// IsRateLimitError checks if an error is a RateLimitError
func IsRateLimitError(err error) bool {
	if err == nil {
		return false
	}
	var rlErr *RateLimitError
	return errors.As(err, &rlErr)
}

// Common user agents for rotation (realistic browser fingerprints)
var userAgents = []string{
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
}

// Accept-Language headers for rotation
var acceptLanguages = []string{
	"en-US,en;q=0.9",
	"en-GB,en;q=0.9",
	"zh-HK,zh;q=0.9,en;q=0.8",
	"zh-TW,zh;q=0.9,en;q=0.8",
	"en-US,en;q=0.9,zh-CN;q=0.8",
}

// Config configures the downloader behavior
type Config struct {
	// Concurrency is the number of concurrent downloads (default: 5)
	Concurrency int

	// S3Bucket is the S3 bucket for uploads (empty = local only)
	S3Bucket string

	// LocalPath is the local directory for downloads (empty = S3 only)
	LocalPath string

	// DryRun logs actions without downloading
	DryRun bool

	// ProxyBaseURL is an optional FireProx URL for IP rotation
	ProxyBaseURL string

	// Timeout is the HTTP request timeout (default: 30s)
	Timeout time.Duration

	// RetryAttempts is the number of retry attempts for failed downloads (default: 3)
	RetryAttempts int

	// RetryDelay is the delay between retries (default: 2s)
	RetryDelay time.Duration

	// MinRequestDelay is the minimum delay between requests (default: 100ms)
	MinRequestDelay time.Duration

	// MaxRequestDelay is the maximum delay between requests (default: 500ms)
	MaxRequestDelay time.Duration
}

// DefaultConfig returns a default configuration
func DefaultConfig() Config {
	return Config{
		Concurrency:     5,
		Timeout:         30 * time.Second,
		RetryAttempts:   3,
		RetryDelay:      5 * time.Second,               // Increased from 2s
		MinRequestDelay: 500 * time.Millisecond,        // Increased from 100ms
		MaxRequestDelay: 2 * time.Second,               // Increased from 500ms
	}
}

// Result represents the result of downloading a single filing
type Result struct {
	FilingID  string
	Success   bool
	LocalPath string
	S3Key     string
	FileSize  int64
	Error     error
	Duration  time.Duration
}

// Downloader handles file downloads from HKEX
type Downloader struct {
	config     Config
	httpClient *http.Client
	s3Client   S3Uploader
}

// S3Uploader interface for S3 operations (allows mocking)
type S3Uploader interface {
	Upload(ctx context.Context, bucket, key string, body io.Reader, contentType string) error
}

// New creates a new Downloader
func New(config Config) *Downloader {
	if config.Concurrency <= 0 {
		config.Concurrency = 5
	}
	if config.Timeout <= 0 {
		config.Timeout = 30 * time.Second
	}
	if config.RetryAttempts <= 0 {
		config.RetryAttempts = 3
	}
	if config.RetryDelay <= 0 {
		config.RetryDelay = 2 * time.Second
	}
	if config.MinRequestDelay <= 0 {
		config.MinRequestDelay = 100 * time.Millisecond
	}
	if config.MaxRequestDelay <= 0 {
		config.MaxRequestDelay = 500 * time.Millisecond
	}

	return &Downloader{
		config: config,
		httpClient: &http.Client{
			Timeout: config.Timeout,
		},
	}
}

// randomDelay returns a random duration between min and max request delay
func (d *Downloader) randomDelay() time.Duration {
	if d.config.MaxRequestDelay <= d.config.MinRequestDelay {
		return d.config.MinRequestDelay
	}
	delta := d.config.MaxRequestDelay - d.config.MinRequestDelay
	return d.config.MinRequestDelay + time.Duration(rand.Int63n(int64(delta)))
}

// randomUserAgent returns a random user agent string
func randomUserAgent() string {
	return userAgents[rand.Intn(len(userAgents))]
}

// randomAcceptLanguage returns a random Accept-Language header
func randomAcceptLanguage() string {
	return acceptLanguages[rand.Intn(len(acceptLanguages))]
}

// SetS3Client sets the S3 client for uploads
func (d *Downloader) SetS3Client(client S3Uploader) {
	d.s3Client = client
}

// Download downloads a single filing
func (d *Downloader) Download(ctx context.Context, filing *models.Filing) *Result {
	start := time.Now()
	result := &Result{
		FilingID: filing.ID,
	}

	if d.config.DryRun {
		result.Success = true
		result.Duration = time.Since(start)
		return result
	}

	// Add random delay before request to avoid detection
	delay := d.randomDelay()
	select {
	case <-ctx.Done():
		result.Error = ctx.Err()
		result.Duration = time.Since(start)
		return result
	case <-time.After(delay):
		// Continue after delay
	}

	// Build the download URL (optionally through proxy)
	downloadURL := d.buildURL(filing.SourceURL)

	// Download with retries
	var body []byte
	var contentType string
	var lastErr error

	for attempt := 1; attempt <= d.config.RetryAttempts; attempt++ {
		body, contentType, lastErr = d.downloadWithContext(ctx, downloadURL)
		if lastErr == nil {
			break
		}

		// Don't retry 404s - they're permanent failures
		if IsURLNotFoundError(lastErr) {
			break
		}

		if attempt < d.config.RetryAttempts {
			var backoff time.Duration

			// Use much longer backoff for rate limiting (403/429)
			if IsRateLimitError(lastErr) {
				// Rate limit: 30-60 seconds backoff with exponential increase
				baseBackoff := 30 * time.Second * time.Duration(attempt)
				jitter := time.Duration(rand.Int63n(int64(30 * time.Second)))
				backoff = baseBackoff + jitter
			} else {
				// Normal errors: standard exponential backoff
				backoff = d.config.RetryDelay * time.Duration(attempt)
				jitter := time.Duration(rand.Int63n(int64(backoff / 2)))
				backoff = backoff + jitter
			}

			select {
			case <-ctx.Done():
				result.Error = ctx.Err()
				result.Duration = time.Since(start)
				return result
			case <-time.After(backoff):
				// Continue after backoff
			}
		}
	}

	if lastErr != nil {
		result.Error = fmt.Errorf("download failed after %d attempts: %w", d.config.RetryAttempts, lastErr)
		result.Duration = time.Since(start)
		return result
	}

	result.FileSize = int64(len(body))

	// Save locally if configured
	if d.config.LocalPath != "" {
		localPath, err := d.saveLocal(filing, body)
		if err != nil {
			result.Error = fmt.Errorf("saving locally: %w", err)
			result.Duration = time.Since(start)
			return result
		}
		result.LocalPath = localPath
	}

	// Upload to S3 if configured
	if d.config.S3Bucket != "" && d.s3Client != nil {
		s3Key := d.buildS3Key(filing)
		err := d.s3Client.Upload(ctx, d.config.S3Bucket, s3Key, strings.NewReader(string(body)), contentType)
		if err != nil {
			result.Error = fmt.Errorf("uploading to S3: %w", err)
			result.Duration = time.Since(start)
			return result
		}
		result.S3Key = s3Key
	}

	result.Success = true
	result.Duration = time.Since(start)
	return result
}

// buildURL constructs the download URL, optionally through a proxy
func (d *Downloader) buildURL(sourceURL string) string {
	if d.config.ProxyBaseURL == "" {
		return sourceURL
	}

	// For FireProx, replace the base URL
	// e.g., https://www1.hkexnews.hk/path -> https://abc123.execute-api.ap-east-1.amazonaws.com/fireprox/path
	if strings.HasPrefix(sourceURL, "https://www1.hkexnews.hk") {
		return strings.Replace(sourceURL, "https://www1.hkexnews.hk", d.config.ProxyBaseURL, 1)
	}

	return sourceURL
}

// downloadWithContext performs the HTTP download
func (d *Downloader) downloadWithContext(ctx context.Context, url string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", fmt.Errorf("creating request: %w", err)
	}

	// Set randomized, realistic browser headers
	req.Header.Set("User-Agent", randomUserAgent())
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7")
	req.Header.Set("Accept-Language", randomAcceptLanguage())
	req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	req.Header.Set("Connection", "keep-alive")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "none")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Cache-Control", "max-age=0")

	resp, err := d.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("executing request: %w", err)
	}
	defer resp.Body.Close()

	// Handle rate limiting (429 Too Many Requests or 403 Forbidden from HKEX)
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusForbidden {
		return nil, "", &RateLimitError{StatusCode: resp.StatusCode, URL: url}
	}

	// Handle 404 - file not found at source URL (permanent failure)
	if resp.StatusCode == http.StatusNotFound {
		return nil, "", &URLNotFoundError{StatusCode: resp.StatusCode, URL: url}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("reading body: %w", err)
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	return body, contentType, nil
}

// saveLocal saves the file to the local filesystem
func (d *Downloader) saveLocal(filing *models.Filing, body []byte) (string, error) {
	// Build path: LocalPath/exchange/company_id/YYYY/MM/DD/sourceID_title.ext
	exchange := strings.ToLower(filing.Exchange)
	if exchange == "" {
		exchange = "unknown"
	}
	companyID := filing.CompanyID
	if companyID == "" {
		companyID = "unknown"
	}
	year := filing.ReportDate.Format("2006")
	month := filing.ReportDate.Format("01")
	day := filing.ReportDate.Format("02")

	dir := filepath.Join(d.config.LocalPath, exchange, companyID, year, month, day)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("creating directory: %w", err)
	}

	// Get extension from FileExtension field, or extract from SourceURL as fallback
	ext := filing.FileExtension
	if ext == "" {
		ext = extractExtensionFromURL(filing.SourceURL)
	}
	if ext == "" {
		ext = "pdf"
	}

	// Sanitize filename
	filename := sanitizeFilename(fmt.Sprintf("%s_%s.%s", filing.SourceID, filing.Title, ext))
	fullPath := filepath.Join(dir, filename)

	if err := os.WriteFile(fullPath, body, 0644); err != nil {
		return "", fmt.Errorf("writing file: %w", err)
	}

	return fullPath, nil
}

// buildS3Key generates the S3 key for a filing
func (d *Downloader) buildS3Key(filing *models.Filing) string {
	// Path: exchange/company_id/YYYY/MM/DD/sourceID.ext
	// Note: title removed from filename to avoid S3 URI issues with Chinese characters
	exchange := strings.ToLower(filing.Exchange)
	if exchange == "" {
		exchange = "unknown"
	}
	companyID := filing.CompanyID
	if companyID == "" {
		companyID = "unknown"
	}
	// Strip "com_" prefix if present (legacy HKEX format)
	companyID = strings.TrimPrefix(companyID, "com_")

	year := filing.ReportDate.Format("2006")
	month := filing.ReportDate.Format("01")
	day := filing.ReportDate.Format("02")

	// Get extension from FileExtension field, or extract from SourceURL as fallback
	ext := filing.FileExtension
	if ext == "" {
		ext = extractExtensionFromURL(filing.SourceURL)
	}
	// Default to "pdf" if still empty
	if ext == "" {
		ext = "pdf"
	}

	filename := fmt.Sprintf("%s.%s", filing.SourceID, ext)

	return fmt.Sprintf("%s/%s/%s/%s/%s/%s", exchange, companyID, year, month, day, filename)
}

// extractExtensionFromURL extracts the file extension from a URL path
func extractExtensionFromURL(url string) string {
	// Find the last path segment
	lastSlash := strings.LastIndex(url, "/")
	if lastSlash == -1 {
		return ""
	}
	filename := url[lastSlash+1:]

	// Remove query string if present
	if queryIdx := strings.Index(filename, "?"); queryIdx != -1 {
		filename = filename[:queryIdx]
	}

	// Extract extension
	ext := filepath.Ext(filename)
	if ext == "" {
		return ""
	}
	// Remove leading dot and convert to lowercase
	ext = strings.ToLower(ext[1:])

	// Only return known document extensions to avoid false positives (e.g., "example.com")
	knownExts := map[string]bool{
		"pdf": true, "htm": true, "html": true,
		"xlsx": true, "xls": true, "doc": true, "docx": true,
		"txt": true, "rtf": true, "csv": true, "xml": true,
	}
	if !knownExts[ext] {
		return ""
	}
	return ext
}

// sanitizeFilename removes invalid characters from a filename
func sanitizeFilename(name string) string {
	// Replace problematic characters
	replacer := strings.NewReplacer(
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
		"\n", "_",
		"\r", "_",
	)
	name = replacer.Replace(name)

	// Truncate if too long (max 200 chars for filename)
	if len(name) > 200 {
		ext := filepath.Ext(name)
		name = name[:200-len(ext)] + ext
	}

	return name
}
