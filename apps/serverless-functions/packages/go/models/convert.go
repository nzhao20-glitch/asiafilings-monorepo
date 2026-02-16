package models

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// IsStructuredProduct returns true if a stock code belongs to a structured
// product range (Derivative Warrants, CBBCs, Inline Warrants). These are
// short-lived leveraged products with boilerplate filings that should be
// excluded from the fundamental research database.
func IsStructuredProduct(stockCode string) bool {
	code, err := strconv.Atoi(strings.TrimLeft(stockCode, "0"))
	if err != nil {
		return false
	}
	switch {
	case code >= 10000 && code <= 29999: // Derivative Warrants
		return true
	case code >= 50000 && code <= 69999: // CBBCs
		return true
	case code >= 80000 && code <= 89999: // Inline Warrants
		return true
	}
	return false
}

// GenerateID generates a unique ID with a prefix
func GenerateID(prefix string) string {
	return fmt.Sprintf("%s_%d", prefix, time.Now().UnixNano())
}

// AnnouncementToFiling converts an HKEX Announcement to a Filing record
func AnnouncementToFiling(ann *Announcement, companyID string) *Filing {
	// Parse release time (format: "DD/MM/YYYY HH:MM")
	reportDate := parseHKEXDate(ann.RelTime)

	// Determine language from title
	language := detectLanguage(ann.Title)

	// Parse file size
	fileSize := parseFileSize(ann.Size)

	// Extract filing type from LTxt (long text) for human-readable category
	// This matches the Search API format for consistency
	filingType := extractFilingType(ann.LTxt)

	return &Filing{
		ID:               GenerateID("fil"),
		CompanyID:        companyID,
		SourceID:         strconv.Itoa(ann.NewsID),
		Exchange:         "HKEX",
		FilingType:       filingType,
		FilingSubType:    ann.T2Code,
		ReportDate:       reportDate,
		Title:            ann.Title,
		SourceURL:        ann.DocumentURL(),
		FileSize:         fileSize,
		FileExtension:    ann.Ext,
		Language:         language,
		ProcessingStatus: ProcessingStatusPending,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
}

// StockToCompany converts an HKEX Stock to a Company record
func StockToCompany(stock *Stock) *Company {
	// Determine if name is English or Chinese
	companyName := stock.SN
	companyNameEn := ""

	// Simple heuristic: if contains mostly ASCII, it's English
	if isEnglishName(stock.SN) {
		companyNameEn = stock.SN
		companyName = stock.SN // Use English as primary if that's what we have
	}

	return &Company{
		ID:            stock.SC, // Use stock code as the company ID
		StockCode:     stock.SC,
		CompanyName:   companyName,
		CompanyNameEn: companyNameEn,
		MarketType:    MarketTypeSEHK,
		Exchange:      "HKEX",
		CreatedAt:     time.Now(),
		UpdatedAt:     time.Now(),
	}
}

// parseHKEXDate parses date in format "DD/MM/YYYY HH:MM"
func parseHKEXDate(s string) time.Time {
	// Try full datetime format
	t, err := time.Parse("02/01/2006 15:04", s)
	if err == nil {
		return t
	}

	// Try date only
	t, err = time.Parse("02/01/2006", s)
	if err == nil {
		return t
	}

	// Return current time as fallback
	return time.Now()
}

// detectLanguage detects if text is primarily English, Chinese, or mixed
func detectLanguage(text string) Language {
	chineseCount := 0
	englishCount := 0

	for _, r := range text {
		if r >= 0x4E00 && r <= 0x9FFF {
			chineseCount++
		} else if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			englishCount++
		}
	}

	total := chineseCount + englishCount
	if total == 0 {
		return LanguageMixed
	}

	chineseRatio := float64(chineseCount) / float64(total)
	if chineseRatio > 0.7 {
		return LanguageZH
	} else if chineseRatio < 0.3 {
		return LanguageEN
	}
	return LanguageMixed
}

// isEnglishName checks if a name is primarily English
func isEnglishName(name string) bool {
	return IsEnglishText(name)
}

// IsEnglishText checks if text is primarily English (exported version)
func IsEnglishText(text string) bool {
	asciiCount := 0
	total := 0

	for _, r := range text {
		if r > 127 {
			total++
		} else if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == ' ' {
			asciiCount++
			total++
		}
	}

	if total == 0 {
		return false
	}
	return float64(asciiCount)/float64(total) > 0.8
}

// parseFileSize parses size strings like "123KB", "1.5MB"
func parseFileSize(s string) int {
	s = strings.TrimSpace(strings.ToUpper(s))

	multiplier := 1
	if strings.HasSuffix(s, "KB") {
		multiplier = 1024
		s = strings.TrimSuffix(s, "KB")
	} else if strings.HasSuffix(s, "MB") {
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "MB")
	} else if strings.HasSuffix(s, "GB") {
		multiplier = 1024 * 1024 * 1024
		s = strings.TrimSuffix(s, "GB")
	}

	val, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return 0
	}

	return int(val * float64(multiplier))
}

// SearchResultToFiling converts a Search API result to a Filing record
func SearchResultToFiling(newsID, title, stockCode, stockName, dateTime, fileType, fileInfo, fileLink, longText string, companyID string) *Filing {
	// Parse release time (format: "DD/MM/YYYY HH:MM")
	reportDate := parseHKEXDate(dateTime)

	// Determine language from title
	language := detectLanguage(title)

	// Parse file size
	fileSize := parseFileSize(fileInfo)

	// Extract filing type from longText (e.g., "Announcements and Notices - [Final Results]")
	filingType := extractFilingType(longText)

	return &Filing{
		ID:               GenerateID("fil"),
		CompanyID:        companyID,
		SourceID:         newsID,
		Exchange:         "HKEX",
		FilingType:       filingType,
		FilingSubType:    "",
		ReportDate:       reportDate,
		Title:            title,
		SourceURL:        buildDocumentURL(fileLink),
		FileSize:         fileSize,
		FileExtension:    strings.ToLower(fileType),
		Language:         language,
		ProcessingStatus: ProcessingStatusPending,
		CreatedAt:        time.Now(),
		UpdatedAt:        time.Now(),
	}
}

// extractFilingType extracts the filing type from the long text description
func extractFilingType(longText string) string {
	// Try to extract category from format like "Announcements and Notices - [Final Results]"
	if idx := strings.Index(longText, " - ["); idx > 0 {
		return strings.TrimSpace(longText[:idx])
	}
	if longText != "" {
		return longText
	}
	return "Other"
}

// buildDocumentURL builds a full URL from a file link
func buildDocumentURL(fileLink string) string {
	if strings.HasPrefix(fileLink, "http") {
		return fileLink
	}
	return "https://www1.hkexnews.hk" + fileLink
}

// FilingCategoryName returns a human-readable name for HKEX filing categories
func FilingCategoryName(t1Code string) string {
	categories := map[string]string{
		"10000": "Equity Securities",
		"20000": "Debt Securities",
		"30000": "Structured Products",
		"40000": "Announcements and Notices",
		"50000": "Listing Documents",
		"60000": "Financial Statements/ESG Information",
		"70000": "Monthly Returns",
		"80000": "Next Day Disclosure Returns",
		"90000": "Proxy Forms",
	}

	if name, ok := categories[t1Code]; ok {
		return name
	}
	return "Other"
}

// ContentItemToExtractedTable converts a SmartDART-compatible ContentItem to an ExtractedTable
// Use this to save extraction results to the database
func ContentItemToExtractedTable(item interface{}, filingID string, tableIndex int) *ExtractedTable {
	// Type assert the item (could be from extraction package)
	contentItem, ok := item.(map[string]interface{})
	if !ok {
		return nil
	}

	// Extract page number
	pageNum := 1
	if page, ok := contentItem["page"].(float64); ok {
		pageNum = int(page)
	}

	// Extract bounding box - convert from [x1, y1, x2, y2] to {x, y, width, height}
	bbox := BoundingBox{X: 0, Y: 0, Width: 100, Height: 100}
	if bboxData, ok := contentItem["bbox"].([]interface{}); ok && len(bboxData) == 4 {
		var x1, y1, x2, y2 float64
		if v, ok := bboxData[0].(float64); ok {
			x1 = v
		}
		if v, ok := bboxData[1].(float64); ok {
			y1 = v
		}
		if v, ok := bboxData[2].(float64); ok {
			x2 = v
		}
		if v, ok := bboxData[3].(float64); ok {
			y2 = v
		}
		bbox.X = x1
		bbox.Y = y1
		bbox.Width = x2 - x1
		bbox.Height = y2 - y1
	}

	// Extract headers and rows from table_data
	var headers [][]string
	var rows [][]string
	var confidence float64

	if tableData, ok := contentItem["table_data"].(map[string]interface{}); ok {
		// Extract confidence
		if conf, ok := tableData["confidence"].(float64); ok {
			confidence = conf
		}

		// Extract headers
		if h, ok := tableData["headers"].([]interface{}); ok {
			headerRow := make([]string, len(h))
			for i, hdr := range h {
				if s, ok := hdr.(string); ok {
					headerRow[i] = s
				}
			}
			headers = [][]string{headerRow}
		}

		// Extract data rows
		if data, ok := tableData["data"].([]interface{}); ok {
			for _, rowData := range data {
				if rowMap, ok := rowData.(map[string]interface{}); ok {
					row := make([]string, 0, len(rowMap))
					for _, v := range rowMap {
						if s, ok := v.(string); ok {
							row = append(row, s)
						} else {
							row = append(row, fmt.Sprintf("%v", v))
						}
					}
					rows = append(rows, row)
				}
			}
		}
	}

	return &ExtractedTable{
		ID:         GenerateID("tbl"),
		FilingID:   filingID,
		PageNumber: pageNum,
		TableIndex: tableIndex,
		Headers:    headers,
		Rows:       rows,
		Position:   bbox,
		Confidence: confidence,
		CreatedAt:  time.Now(),
	}
}
