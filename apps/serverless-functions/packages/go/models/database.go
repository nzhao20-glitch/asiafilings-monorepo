package models

import (
	"time"
)

// ProcessingStatus represents the state of document processing
type ProcessingStatus string

const (
	ProcessingStatusPending     ProcessingStatus = "PENDING"
	ProcessingStatusProcessing  ProcessingStatus = "PROCESSING"
	ProcessingStatusCompleted   ProcessingStatus = "COMPLETED"
	ProcessingStatusFailed      ProcessingStatus = "FAILED"
	ProcessingStatusURLFailure  ProcessingStatus = "URL_FAILURE"  // Source URL returns 404 or is broken
	ProcessingStatusRateLimited ProcessingStatus = "RATE_LIMITED" // Rate limited by HKEX (403/429), can retry later
)

// Language represents the document language
type Language string

const (
	LanguageEN    Language = "EN"
	LanguageZH    Language = "ZH"
	LanguageMixed Language = "MIXED"
)

// MarketType represents the exchange market
type MarketType string

const (
	MarketTypeSEHK  MarketType = "SEHK"  // Main Board
	MarketTypeGEM   MarketType = "GEM"   // Growth Enterprise Market
	MarketTypeOther MarketType = "OTHER"
)

// Company represents a listed company (compatible with SmartDART)
type Company struct {
	ID            string     `json:"id" db:"id"`
	StockCode     string     `json:"stockCode" db:"stock_code"`
	CompanyName   string     `json:"companyName" db:"company_name"`
	CompanyNameEn string     `json:"companyNameEn,omitempty" db:"company_name_en"`
	MarketType    MarketType `json:"marketType" db:"market_type"`
	Industry      string     `json:"industry,omitempty" db:"industry"`
	Exchange      string     `json:"exchange" db:"exchange"` // "HKEX", "DART", etc.
	CreatedAt     time.Time  `json:"createdAt" db:"created_at"`
	UpdatedAt     time.Time  `json:"updatedAt" db:"updated_at"`
}

// Filing represents a filing/announcement (compatible with SmartDART)
type Filing struct {
	ID            string `json:"id" db:"id"`
	CompanyID     string `json:"companyId" db:"company_id"`
	SourceID      string `json:"sourceId" db:"source_id"`       // HKEX: NewsID | DART: rcept_no
	Exchange      string `json:"exchange" db:"exchange"`        // "HKEX", "DART"
	FilingType    string `json:"filingType" db:"filing_type"`   // HKEX: T1Code | DART: report_type
	FilingSubType string `json:"filingSubType,omitempty" db:"filing_sub_type"` // HKEX: T2Code
	ReportDate       time.Time        `json:"reportDate" db:"report_date"`
	Title            string           `json:"title" db:"title"`
	TitleEn          string           `json:"titleEn,omitempty" db:"title_en"`
	SourceURL        string           `json:"sourceUrl" db:"source_url"` // Original HKEX URL
	PDFS3Key         string           `json:"pdfS3Key,omitempty" db:"pdf_s3_key"`
	LocalPath        string           `json:"localPath,omitempty" db:"local_path"`
	PageCount        int              `json:"pageCount,omitempty" db:"page_count"`
	FileSize         int              `json:"fileSize,omitempty" db:"file_size"`
	FileExtension    string           `json:"fileExtension" db:"file_extension"` // pdf, htm
	Language         Language         `json:"language" db:"language"`
	ProcessingStatus ProcessingStatus `json:"processingStatus" db:"processing_status"`
	ProcessingError  string           `json:"processingError,omitempty" db:"processing_error"`
	IngestedAt       *time.Time       `json:"ingestedAt,omitempty" db:"ingested_at"`
	CreatedAt        time.Time        `json:"createdAt" db:"created_at"`
	UpdatedAt        time.Time        `json:"updatedAt" db:"updated_at"`

	// Relations (populated when needed)
	Company *Company         `json:"company,omitempty"`
	Tables  []ExtractedTable `json:"tables,omitempty"`
}

// ExtractedTable represents a table extracted from a document (compatible with SmartDART)
type ExtractedTable struct {
	ID         string        `json:"id" db:"id"`
	FilingID   string        `json:"filingId" db:"filing_id"`
	PageNumber int           `json:"pageNumber" db:"page_number"`
	TableIndex int           `json:"tableIndex" db:"table_index"`
	Headers    [][]string    `json:"headers" db:"headers"`   // Multi-row headers
	Rows       [][]string    `json:"rows" db:"rows"`         // Table data rows
	Position   BoundingBox   `json:"position" db:"position"` // Location on page
	Confidence float64       `json:"confidence,omitempty" db:"confidence"`
	CreatedAt  time.Time     `json:"createdAt" db:"created_at"`
}

// BoundingBox represents the position of an element on a page
type BoundingBox struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

// FilingMetadata stores additional processing metadata
type FilingMetadata struct {
	ID              string           `json:"id" db:"id"`
	FilingID        string           `json:"filingId" db:"filing_id"`
	ExtractedText   string           `json:"extractedText,omitempty" db:"extracted_text"`
	ProcessingStatus ProcessingStatus `json:"processingStatus" db:"processing_status"`
	ProcessingError string           `json:"processingError,omitempty" db:"processing_error"`
	CreatedAt       time.Time        `json:"createdAt" db:"created_at"`
	UpdatedAt       time.Time        `json:"updatedAt" db:"updated_at"`
}

// ExtractionResult matches SmartDART's unified extraction format
type ExtractionResult struct {
	FilingID           string             `json:"filing_id"`
	CompanyID          string             `json:"company_id,omitempty"`
	TotalPages         int                `json:"total_pages"`
	ExtractionMetadata ExtractionMetadata `json:"extraction_metadata"`
	Content            []ContentItem      `json:"content"`
}

// ExtractionMetadata contains extraction statistics
type ExtractionMetadata struct {
	ProcessingTime    float64       `json:"processing_time"`
	ConfidenceOverall float64       `json:"confidence_overall"`
	ExtractionDate    string        `json:"extraction_date"`
	ExtractorVersion  string        `json:"extractor_version"`
	ContentCounts     ContentCounts `json:"content_counts"`
}

// ContentCounts tracks extracted content statistics
type ContentCounts struct {
	Paragraphs int `json:"paragraphs"`
	Tables     int `json:"tables"`
	Total      int `json:"total"`
}

// ContentItem represents an extracted element (table or paragraph)
type ContentItem struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"` // "table" or "paragraph"
	Page      int        `json:"page"`
	BBox      [4]float64 `json:"bbox"` // [x1, y1, x2, y2]
	Text      string     `json:"text"`
	Section   string     `json:"section,omitempty"`
	TableData *TableData `json:"table_data,omitempty"`
}

// TableData contains structured table information
type TableData struct {
	Rows       int                      `json:"rows"`
	Cols       int                      `json:"cols"`
	Confidence float64                  `json:"confidence"`
	Headers    []string                 `json:"headers"`
	Data       []map[string]interface{} `json:"data"`
}
