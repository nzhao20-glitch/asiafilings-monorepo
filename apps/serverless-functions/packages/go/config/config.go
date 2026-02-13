package config

import (
	"os"
	"strconv"
)

// Config holds application configuration
type Config struct {
	// HKEX API settings
	BaseURL   string
	MaxPages  int
	RateLimit int // requests per second

	// Storage settings
	S3Bucket  string
	S3Region  string
	LocalPath string

	// Database settings
	DatabaseURL  string
	EnableDB     bool

	// Processing settings
	DownloadPDFs    bool
	ExtractTables   bool
	TableServiceURL string
}

// Load creates a Config from environment variables with defaults
func Load() *Config {
	return &Config{
		BaseURL:         getEnv("HKEX_BASE_URL", "https://www1.hkexnews.hk"),
		MaxPages:        getEnvInt("HKEX_MAX_PAGES", 10),
		RateLimit:       getEnvInt("HKEX_RATE_LIMIT", 2),
		S3Bucket:        getEnv("S3_BUCKET", ""),
		S3Region:        getEnv("AWS_REGION", "ap-east-1"), // Hong Kong region
		LocalPath:       getEnv("LOCAL_STORAGE_PATH", "./downloads"),
		DatabaseURL:     getEnv("DATABASE_URL", "./hkex.db"),
		EnableDB:        getEnvBool("ENABLE_DB", true),
		DownloadPDFs:    getEnvBool("DOWNLOAD_PDFS", true),
		ExtractTables:   getEnvBool("EXTRACT_TABLES", false),
		TableServiceURL: getEnv("TABLE_SERVICE_URL", "http://localhost:8001"),
	}
}

// AnnouncementListURL returns the URL for fetching announcement list
func (c *Config) AnnouncementListURL(page int) string {
	return c.BaseURL + "/ncms/json/eds/lcisehk1relsdc_" + strconv.Itoa(page) + ".json"
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvBool(key string, defaultVal bool) bool {
	if val := os.Getenv(key); val != "" {
		if b, err := strconv.ParseBool(val); err == nil {
			return b
		}
	}
	return defaultVal
}
