package storage

import (
	"context"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// Storage defines the interface for storing documents
type Storage interface {
	// Save stores a document and returns the storage path
	Save(ctx context.Context, announcement *models.Announcement, data []byte) (string, error)
	// Exists checks if a document already exists
	Exists(ctx context.Context, announcement *models.Announcement) (bool, error)
	// Get retrieves a stored document
	Get(ctx context.Context, announcement *models.Announcement) ([]byte, error)
}

// DocumentPath generates a consistent path for storing documents
// Format: {year}/{stockCode}/{newsId}.{ext}
func DocumentPath(announcement *models.Announcement) string {
	stockCode := "unknown"
	if len(announcement.Stock) > 0 {
		stockCode = announcement.Stock[0].SC
	}

	// Extract year from WebPath (format: /listedco/listconews/sehk/2025/1127/filename.pdf)
	year := "unknown"
	parts := splitPath(announcement.WebPath)
	for i, p := range parts {
		if len(p) == 4 && p[0] == '2' && p[1] == '0' {
			year = p
			break
		}
		// Fallback: year is typically after "sehk"
		if p == "sehk" && i+1 < len(parts) {
			year = parts[i+1]
			break
		}
	}

	return year + "/" + stockCode + "/" + itoa(announcement.NewsID) + "." + announcement.Ext
}

func splitPath(path string) []string {
	var parts []string
	var current []byte
	for i := 0; i < len(path); i++ {
		if path[i] == '/' {
			if len(current) > 0 {
				parts = append(parts, string(current))
				current = nil
			}
		} else {
			current = append(current, path[i])
		}
	}
	if len(current) > 0 {
		parts = append(parts, string(current))
	}
	return parts
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
