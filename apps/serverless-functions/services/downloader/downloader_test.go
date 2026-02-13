package downloader

import (
	"testing"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

func TestExtractExtensionFromURL(t *testing.T) {
	tests := []struct {
		name     string
		url      string
		expected string
	}{
		{
			name:     "PDF file",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0330/2025033000043.pdf",
			expected: "pdf",
		},
		{
			name:     "HTM file",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2015/1217/ltn20151217071.htm",
			expected: "htm",
		},
		{
			name:     "HTML file",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2020/0101/file.html",
			expected: "html",
		},
		{
			name:     "XLSX file",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2020/0101/data.xlsx",
			expected: "xlsx",
		},
		{
			name:     "URL with query string",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2020/0101/file.pdf?download=true",
			expected: "pdf",
		},
		{
			name:     "Uppercase extension",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2020/0101/FILE.PDF",
			expected: "pdf",
		},
		{
			name:     "No extension",
			url:      "https://www1.hkexnews.hk/listedco/listconews/sehk/2020/0101/noext",
			expected: "",
		},
		{
			name:     "Empty URL",
			url:      "",
			expected: "",
		},
		{
			name:     "URL without path",
			url:      "https://example.com",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := extractExtensionFromURL(tt.url)
			if result != tt.expected {
				t.Errorf("extractExtensionFromURL(%q) = %q, want %q", tt.url, result, tt.expected)
			}
		})
	}
}

func TestBuildS3Key_FallbackExtension(t *testing.T) {
	d := New(DefaultConfig())

	tests := []struct {
		name        string
		filing      *models.Filing
		expectedExt string
	}{
		{
			name: "Uses FileExtension when present",
			filing: &models.Filing{
				SourceID:      "12345",
				Exchange:      "HKEX",
				CompanyID:     "00001",
				ReportDate:    time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
				FileExtension: "pdf",
				SourceURL:     "https://example.com/file.htm",
			},
			expectedExt: "pdf",
		},
		{
			name: "Extracts from URL when FileExtension empty",
			filing: &models.Filing{
				SourceID:      "12345",
				Exchange:      "HKEX",
				CompanyID:     "00001",
				ReportDate:    time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
				FileExtension: "",
				SourceURL:     "https://www1.hkexnews.hk/listedco/listconews/sehk/2025/0115/file.htm",
			},
			expectedExt: "htm",
		},
		{
			name: "Defaults to pdf when both empty",
			filing: &models.Filing{
				SourceID:      "12345",
				Exchange:      "HKEX",
				CompanyID:     "00001",
				ReportDate:    time.Date(2025, 1, 15, 0, 0, 0, 0, time.UTC),
				FileExtension: "",
				SourceURL:     "https://example.com/noext",
			},
			expectedExt: "pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := d.buildS3Key(tt.filing)
			expectedSuffix := "." + tt.expectedExt
			if !contains(result, expectedSuffix) {
				t.Errorf("buildS3Key() = %q, expected to end with %q", result, expectedSuffix)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && s[len(s)-len(substr):] == substr
}
