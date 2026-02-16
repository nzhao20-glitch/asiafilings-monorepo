package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"
)

const (
	securitiesURL = "https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx"
	userAgent     = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

// excludedCategories are structured products we skip entirely.
// DWs, CBBCs, and Inline Warrants are thousands of short-lived leveraged
// products with repetitive boilerplate filings — they bloat storage and
// clutter search results for fundamental researchers.
var excludedCategories = map[string]bool{
	"Derivative Warrants":          true,
	"Callable Bull/Bear Contracts": true,
	"Inline Warrants":              true,
}

// Security represents a row from the HKEX securities list.
type Security struct {
	StockCode   string
	Name        string
	Category    string // e.g. "Equity", "Debt Securities", "Real Estate Investment Trusts"
	SubCategory string // e.g. "Equity Securities (Main Board)", "Exchange Traded Funds"
}

func main() {
	dryRun := flag.Bool("dry-run", false, "Don't write to database, just show new codes")
	dbURL := flag.String("db", "", "PostgreSQL connection string (default: DATABASE_URL env)")
	flag.Parse()

	dsn := *dbURL
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" && !*dryRun {
		log.Fatal("DATABASE_URL is required (set env or pass -db flag)")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("Shutting down...")
		cancel()
	}()

	// 1. Download and parse the securities list
	log.Println("Downloading HKEX List of Securities...")
	securities, err := fetchSecuritiesList(ctx)
	if err != nil {
		log.Fatalf("Failed to fetch securities list: %v", err)
	}
	log.Printf("Parsed %d securities from HKEX (excluding DWs/CBBCs)", len(securities))

	// Build set of HKEX stock codes
	hkexCodes := make(map[string]Security, len(securities))
	for _, s := range securities {
		hkexCodes[s.StockCode] = s
	}

	// 2. Get existing codes from the database
	var existingCodes map[string]bool
	var pool *pgxpool.Pool

	if dsn != "" {
		pool, err = pgxpool.New(ctx, dsn)
		if err != nil {
			log.Fatalf("Failed to connect to database: %v", err)
		}
		defer pool.Close()

		existingCodes, err = getExistingStockCodes(ctx, pool)
		if err != nil {
			log.Fatalf("Failed to query existing codes: %v", err)
		}
		log.Printf("Found %d existing stock codes in database", len(existingCodes))
	} else {
		// Dry-run without DB — use an empty set so everything looks "new"
		log.Println("No database connection (dry-run mode)")
		existingCodes = make(map[string]bool)
	}

	// 3. Diff: find codes in HKEX list that are not in our database
	var newSecurities []Security
	for code, sec := range hkexCodes {
		if !existingCodes[code] {
			newSecurities = append(newSecurities, sec)
		}
	}

	if len(newSecurities) == 0 {
		log.Println("No new stock codes found")
		return
	}

	log.Printf("Discovered %d new stock codes", len(newSecurities))
	fmt.Println()
	fmt.Println("=== New Stock Codes ===")
	for _, s := range newSecurities {
		fmt.Printf("  %s  %-40s  [%s]\n", s.StockCode, s.Name, s.Category+": "+s.SubCategory)
	}

	// 4. Upsert new companies into the database
	if *dryRun || pool == nil {
		log.Println("Dry-run mode — skipping database writes")
		return
	}

	inserted := 0
	for _, s := range newSecurities {
		if err := upsertCompany(ctx, pool, s); err != nil {
			log.Printf("Error upserting %s: %v", s.StockCode, err)
			continue
		}
		inserted++
	}

	fmt.Println()
	log.Printf("Upserted %d/%d new companies into database", inserted, len(newSecurities))
}

// fetchSecuritiesList downloads the HKEX xlsx and returns filtered equity securities.
func fetchSecuritiesList(ctx context.Context) ([]Security, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, securitiesURL, nil)
	if err != nil {
		return nil, fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("downloading file: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	// Write to temp file (excelize needs a reader, not streaming)
	tmp, err := os.CreateTemp("", "hkex-securities-*.xlsx")
	if err != nil {
		return nil, fmt.Errorf("creating temp file: %w", err)
	}
	defer os.Remove(tmp.Name())
	defer tmp.Close()

	if _, err := io.Copy(tmp, resp.Body); err != nil {
		return nil, fmt.Errorf("writing temp file: %w", err)
	}

	// Parse the Excel file
	f, err := excelize.OpenFile(tmp.Name())
	if err != nil {
		return nil, fmt.Errorf("opening xlsx: %w", err)
	}
	defer f.Close()

	sheetName := f.GetSheetName(0)
	rows, err := f.GetRows(sheetName)
	if err != nil {
		return nil, fmt.Errorf("reading rows: %w", err)
	}

	if len(rows) < 4 {
		return nil, fmt.Errorf("unexpected spreadsheet format: only %d rows", len(rows))
	}

	// The HKEX xlsx layout has:
	//   Row 0: "List of Securities" (title)
	//   Row 1: "Updated as at DD/MM/YYYY" (date)
	//   Row 2: Merged header row (not machine-parseable)
	//   Row 3+: Data with fixed columns:
	//     [0] Stock Code  [1] Name of Securities  [2] Category  [3] Sub-Category
	//     [4] Board Lot   [5] ISIN                [6] Expiry Date ...
	const (
		colStockCode   = 0
		colName        = 1
		colCategory    = 2 // "Equity", "Debt Securities", "Derivative Warrants", etc.
		colSubCategory = 3 // "Equity Securities (Main Board)", "Exchange Traded Funds", etc.
	)

	// Skip title (row 0), date (row 1), and header (row 2)
	var securities []Security
	skipped := 0
	for _, row := range rows[3:] {
		if len(row) <= colCategory {
			continue
		}

		category := strings.TrimSpace(row[colCategory])
		if excludedCategories[category] {
			skipped++
			continue
		}

		code := strings.TrimSpace(row[colStockCode])
		if code == "" {
			continue
		}

		// Pad to 5 digits (HKEX convention)
		code = padStockCode(code)

		name := strings.TrimSpace(row[colName])
		subCategory := ""
		if len(row) > colSubCategory {
			subCategory = strings.TrimSpace(row[colSubCategory])
		}

		securities = append(securities, Security{
			StockCode:   code,
			Name:        name,
			Category:    category,
			SubCategory: subCategory,
		})
	}

	log.Printf("Skipped %d structured products (DWs/CBBCs)", skipped)
	return securities, nil
}

// padStockCode zero-pads a stock code to 5 characters.
func padStockCode(code string) string {
	for len(code) < 5 {
		code = "0" + code
	}
	return code
}

// getExistingStockCodes queries all HKEX stock codes from the companies table.
func getExistingStockCodes(ctx context.Context, pool *pgxpool.Pool) (map[string]bool, error) {
	rows, err := pool.Query(ctx,
		`SELECT COALESCE(stock_code, '') FROM companies WHERE exchange = 'HKEX'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	codes := make(map[string]bool)
	for rows.Next() {
		var code string
		if err := rows.Scan(&code); err != nil {
			return nil, err
		}
		if code != "" {
			codes[padStockCode(code)] = true
		}
	}
	return codes, rows.Err()
}

// upsertCompany inserts a new company or updates the name if it already exists.
func upsertCompany(ctx context.Context, pool *pgxpool.Pool, s Security) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO companies (company_id, name, stock_code, exchange, updated_at)
		VALUES ($1, $2, $3, 'HKEX', NOW())
		ON CONFLICT(exchange, company_id) DO UPDATE SET
			name = EXCLUDED.name,
			stock_code = EXCLUDED.stock_code,
			updated_at = NOW()
	`, s.StockCode, s.Name, s.StockCode)
	return err
}
