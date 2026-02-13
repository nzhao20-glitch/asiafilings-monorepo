package models

// AnnouncementResponse represents the JSON response from HKEXnews API
type AnnouncementResponse struct {
	GenDate      string         `json:"genDate"` // Timestamp as string
	MaxNumOfFile int            `json:"maxNumOfFile"`
	NewsInfoLst  []Announcement `json:"newsInfoLst"`
}

// Announcement represents a single filing/announcement from HKEX
type Announcement struct {
	NewsID  int     `json:"newsId"`
	Title   string  `json:"title"`
	STxt    string  `json:"sTxt"`    // Short text description
	LTxt    string  `json:"lTxt"`    // Long text with category tags
	Stock   []Stock `json:"stock"`   // List of related stocks
	WebPath string  `json:"webPath"` // Relative path to document
	Ext     string  `json:"ext"`     // File extension (pdf, htm)
	Size    string  `json:"size"`    // File size with unit
	RelTime string  `json:"relTime"` // Release time (DD/MM/YYYY HH:MM)
	T1Code  string  `json:"t1Code"`  // Primary category code
	T2Code  string  `json:"t2Code"`  // Secondary category codes (comma-separated)
	Market  string  `json:"market"`  // Exchange code (SEHK)
	DOD     string  `json:"dod"`     // Day-of-disclosure flag
	Multi   int     `json:"multi"`   // Multiple documents indicator
}

// Stock represents a company/stock referenced in an announcement
type Stock struct {
	SC string `json:"sc"` // Stock code
	SN string `json:"sn"` // Stock name
}

// DocumentURL returns the full URL for downloading the document
func (a *Announcement) DocumentURL() string {
	return "https://www1.hkexnews.hk" + a.WebPath
}

// IsPDF returns true if the document is a PDF
func (a *Announcement) IsPDF() bool {
	return a.Ext == "pdf"
}

// IsHTML returns true if the document is HTML
func (a *Announcement) IsHTML() bool {
	return a.Ext == "htm" || a.Ext == "html"
}
