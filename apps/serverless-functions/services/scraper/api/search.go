package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/config"
)

// SearchClient handles requests to the HKEX Title Search API
// Used for historical backfill with date range queries
type SearchClient struct {
	httpClient *http.Client
	config     *config.Config
	lastReq    time.Time
}

// SearchResult represents a single result from the Search API
type SearchResult struct {
	NewsID     string `json:"NEWS_ID"`
	Title      string `json:"TITLE"`
	StockCode  string `json:"STOCK_CODE"`
	StockName  string `json:"STOCK_NAME"`
	DateTime   string `json:"DATE_TIME"` // Format: "DD/MM/YYYY HH:MM"
	FileType   string `json:"FILE_TYPE"`
	FileInfo   string `json:"FILE_INFO"` // e.g., "222KB"
	FileLink   string `json:"FILE_LINK"` // e.g., "/listedco/listconews/sehk/2020/0131/..."
	ShortText  string `json:"SHORT_TEXT"`
	LongText   string `json:"LONG_TEXT"`
	TotalCount string `json:"TOTAL_COUNT"` // Total matching results
}

// SearchResponse wraps the search API response
type SearchResponse struct {
	Result       string `json:"result"`       // JSON array as string
	HasNextRow   bool   `json:"hasNextRow"`
	RowRange     int    `json:"rowRange"`
	LoadedRecord int    `json:"loadedRecord"`
	RecordCnt    int    `json:"recordCnt"`
}

// SearchParams configures a search query
type SearchParams struct {
	FromDate     time.Time // Start date
	ToDate       time.Time // End date
	Market       string    // SEHK, GEM, or empty for all
	StockCode    string    // Specific stock code or empty for all
	Category     int       // Document category (-2 for all)
	RowRange     int       // Results per page (SearchAll paginates automatically)
	Offset       int       // Pagination offset
	SortDir      int       // 0 = descending (newest first), 1 = ascending
}

// DefaultSearchParams returns default search parameters
func DefaultSearchParams() SearchParams {
	return SearchParams{
		FromDate: time.Now().AddDate(0, -1, 0), // Last month
		ToDate:   time.Now(),
		Market:   "SEHK",
		Category: -2,  // All categories
		RowRange: 50000, // Fetch all results in one call (HKEX API ignores offset-based pagination)
		Offset:   0,
		SortDir:  0, // Newest first
	}
}

// NewSearchClient creates a new Search API client
func NewSearchClient(cfg *config.Config) *SearchClient {
	return &SearchClient{
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
		config: cfg,
	}
}

// Search performs a single search query and returns results, total count, and
// whether more rows are available (for pagination).
func (c *SearchClient) Search(params SearchParams) ([]SearchResult, int, bool, error) {
	c.rateLimit()

	// Build query URL
	baseURL := c.config.BaseURL + "/search/titleSearchServlet.do"

	queryParams := url.Values{}
	queryParams.Set("sortDir", strconv.Itoa(params.SortDir))
	queryParams.Set("sortByOptions", "DateTime")
	queryParams.Set("category", "0")
	queryParams.Set("market", params.Market)
	queryParams.Set("searchType", "0")
	queryParams.Set("documentType", "-1")
	queryParams.Set("fromDate", params.FromDate.Format("20060102"))
	queryParams.Set("toDate", params.ToDate.Format("20060102"))
	queryParams.Set("t1code", strconv.Itoa(params.Category))
	queryParams.Set("t2Gcode", "-2")
	queryParams.Set("t2code", "-2")
	queryParams.Set("rowRange", strconv.Itoa(params.RowRange))
	queryParams.Set("lang", "EN")

	if params.StockCode != "" {
		queryParams.Set("stockCode", params.StockCode)
	}
	if params.Offset > 0 {
		queryParams.Set("loadedRecord", strconv.Itoa(params.Offset))
	}

	fullURL := baseURL + "?" + queryParams.Encode()

	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		return nil, 0, false, fmt.Errorf("creating request: %w", err)
	}

	req.Header.Set("User-Agent", "HKEXScraper/1.0")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, false, fmt.Errorf("executing search: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, 0, false, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	// Parse wrapper response
	var wrapper SearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&wrapper); err != nil {
		return nil, 0, false, fmt.Errorf("decoding response wrapper: %w", err)
	}

	// Handle empty results
	if wrapper.Result == "null" || wrapper.Result == "" {
		return []SearchResult{}, 0, false, nil
	}

	// Parse the inner result array (it's a JSON string)
	var results []SearchResult
	if err := json.Unmarshal([]byte(wrapper.Result), &results); err != nil {
		return nil, 0, false, fmt.Errorf("decoding results: %w", err)
	}

	// Get total count from first result
	totalCount := 0
	if len(results) > 0 && results[0].TotalCount != "" {
		totalCount, _ = strconv.Atoi(results[0].TotalCount)
	}

	return results, totalCount, wrapper.HasNextRow, nil
}

// SearchAll fetches all results for a query, paginating automatically using
// the API's hasNextRow / loadedRecord mechanism.
func (c *SearchClient) SearchAll(params SearchParams) ([]SearchResult, error) {
	if params.RowRange <= 0 {
		params.RowRange = 500
	}

	var allResults []SearchResult
	offset := params.Offset

	for {
		params.Offset = offset
		results, totalCount, hasNext, err := c.Search(params)
		if err != nil {
			return nil, err
		}

		allResults = append(allResults, results...)

		if !hasNext || len(results) == 0 {
			break
		}

		offset += len(results)

		// Safety: stop if we've fetched everything reported by totalCount
		if totalCount > 0 && offset >= totalCount {
			break
		}
	}

	return allResults, nil
}

// SearchByDateRange fetches announcements within a date range
// Automatically splits large ranges into monthly chunks to avoid timeouts
func (c *SearchClient) SearchByDateRange(from, to time.Time, market string) ([]SearchResult, error) {
	var allResults []SearchResult

	// Process month by month for large date ranges
	current := from
	for current.Before(to) {
		// Calculate end of current chunk (end of month or 'to' date)
		endOfMonth := time.Date(current.Year(), current.Month()+1, 0, 23, 59, 59, 0, current.Location())
		chunkEnd := endOfMonth
		if chunkEnd.After(to) {
			chunkEnd = to
		}

		params := SearchParams{
			FromDate: current,
			ToDate:   chunkEnd,
			Market:   market,
			Category: -2,
			RowRange: 50000, // Fetch all results in one call (HKEX API ignores offset-based pagination)
			SortDir:  0,
		}

		results, err := c.SearchAll(params)
		if err != nil {
			return nil, fmt.Errorf("searching %s to %s: %w",
				current.Format("2006-01-02"), chunkEnd.Format("2006-01-02"), err)
		}

		allResults = append(allResults, results...)

		// Move to next month
		current = time.Date(current.Year(), current.Month()+1, 1, 0, 0, 0, 0, current.Location())
	}

	return allResults, nil
}

// DocumentURL returns the full URL for downloading a document
func (r *SearchResult) DocumentURL() string {
	if strings.HasPrefix(r.FileLink, "http") {
		return r.FileLink
	}
	return "https://www1.hkexnews.hk" + r.FileLink
}

// ParseDateTime parses the DateTime field into a time.Time
func (r *SearchResult) ParseDateTime() (time.Time, error) {
	return time.Parse("02/01/2006 15:04", r.DateTime)
}

// rateLimit ensures we don't exceed the configured rate limit
func (c *SearchClient) rateLimit() {
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
