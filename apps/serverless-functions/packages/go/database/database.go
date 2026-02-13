package database

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
	_ "modernc.org/sqlite"
)

// DB wraps the database connection
type DB struct {
	conn *sql.DB
}

// New creates a new database connection
func New(dsn string) (*DB, error) {
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// Enable foreign keys
	if _, err := conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return nil, fmt.Errorf("enabling foreign keys: %w", err)
	}

	db := &DB{conn: conn}

	// Initialize schema
	if err := db.initSchema(); err != nil {
		return nil, fmt.Errorf("initializing schema: %w", err)
	}

	return db, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// initSchema creates the database tables
func (db *DB) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS companies (
		id TEXT PRIMARY KEY,
		stock_code TEXT UNIQUE NOT NULL,
		company_name TEXT NOT NULL,
		company_name_en TEXT,
		market_type TEXT NOT NULL DEFAULT 'SEHK',
		industry TEXT,
		exchange TEXT NOT NULL DEFAULT 'HKEX',
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS filings (
		id TEXT PRIMARY KEY,
		company_id TEXT NOT NULL REFERENCES companies(id),
		source_id TEXT NOT NULL,
		exchange TEXT NOT NULL DEFAULT 'HKEX',
		filing_type TEXT NOT NULL,
		filing_sub_type TEXT,
		report_date DATETIME NOT NULL,
		title TEXT NOT NULL,
		title_en TEXT,
		source_url TEXT NOT NULL,
		pdf_s3_key TEXT,
		local_path TEXT,
		page_count INTEGER,
		file_size INTEGER,
		file_extension TEXT NOT NULL,
		language TEXT NOT NULL DEFAULT 'ZH',
		processing_status TEXT NOT NULL DEFAULT 'PENDING',
		processing_error TEXT,
		ingested_at DATETIME,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(exchange, source_id)
	);

	CREATE INDEX IF NOT EXISTS idx_filings_company_id ON filings(company_id);
	CREATE INDEX IF NOT EXISTS idx_filings_report_date ON filings(report_date);
	CREATE INDEX IF NOT EXISTS idx_filings_processing_status ON filings(processing_status);

	CREATE TABLE IF NOT EXISTS extracted_tables (
		id TEXT PRIMARY KEY,
		filing_id TEXT NOT NULL REFERENCES filings(id),
		page_number INTEGER NOT NULL,
		table_index INTEGER NOT NULL,
		headers TEXT NOT NULL,
		rows TEXT NOT NULL,
		position TEXT NOT NULL,
		confidence REAL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_extracted_tables_filing_page ON extracted_tables(filing_id, page_number);

	CREATE TABLE IF NOT EXISTS filing_metadata (
		id TEXT PRIMARY KEY,
		filing_id TEXT UNIQUE NOT NULL REFERENCES filings(id),
		extracted_text TEXT,
		processing_status TEXT NOT NULL DEFAULT 'PENDING',
		processing_error TEXT,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	`

	_, err := db.conn.Exec(schema)
	return err
}

// UpsertCompany creates or updates a company
func (db *DB) UpsertCompany(ctx context.Context, company *models.Company) error {
	query := `
		INSERT INTO companies (id, stock_code, company_name, company_name_en, market_type, industry, exchange, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(stock_code) DO UPDATE SET
			company_name = excluded.company_name,
			company_name_en = excluded.company_name_en,
			market_type = excluded.market_type,
			industry = excluded.industry,
			updated_at = excluded.updated_at
	`

	now := time.Now()
	if company.CreatedAt.IsZero() {
		company.CreatedAt = now
	}
	company.UpdatedAt = now

	_, err := db.conn.ExecContext(ctx, query,
		company.ID,
		company.StockCode,
		company.CompanyName,
		company.CompanyNameEn,
		company.MarketType,
		company.Industry,
		company.Exchange,
		company.CreatedAt,
		company.UpdatedAt,
	)
	return err
}

// GetCompanyByStockCode retrieves a company by stock code
func (db *DB) GetCompanyByStockCode(ctx context.Context, stockCode string) (*models.Company, error) {
	query := `SELECT id, stock_code, company_name, company_name_en, market_type, industry, exchange, created_at, updated_at
			  FROM companies WHERE stock_code = ?`

	var c models.Company
	err := db.conn.QueryRowContext(ctx, query, stockCode).Scan(
		&c.ID, &c.StockCode, &c.CompanyName, &c.CompanyNameEn,
		&c.MarketType, &c.Industry, &c.Exchange, &c.CreatedAt, &c.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// UpsertFiling creates or updates a filing
func (db *DB) UpsertFiling(ctx context.Context, filing *models.Filing) error {
	query := `
		INSERT INTO filings (id, company_id, source_id, exchange, filing_type, filing_sub_type,
			report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(exchange, source_id) DO UPDATE SET
			filing_type = excluded.filing_type,
			filing_sub_type = excluded.filing_sub_type,
			title = excluded.title,
			title_en = excluded.title_en,
			pdf_s3_key = excluded.pdf_s3_key,
			local_path = excluded.local_path,
			page_count = excluded.page_count,
			file_size = excluded.file_size,
			processing_status = excluded.processing_status,
			processing_error = excluded.processing_error,
			ingested_at = excluded.ingested_at,
			updated_at = excluded.updated_at
	`

	now := time.Now()
	if filing.CreatedAt.IsZero() {
		filing.CreatedAt = now
	}
	filing.UpdatedAt = now

	_, err := db.conn.ExecContext(ctx, query,
		filing.ID,
		filing.CompanyID,
		filing.SourceID,
		filing.Exchange,
		filing.FilingType,
		filing.FilingSubType,
		filing.ReportDate,
		filing.Title,
		filing.TitleEn,
		filing.SourceURL,
		filing.PDFS3Key,
		filing.LocalPath,
		filing.PageCount,
		filing.FileSize,
		filing.FileExtension,
		filing.Language,
		filing.ProcessingStatus,
		filing.ProcessingError,
		filing.IngestedAt,
		filing.CreatedAt,
		filing.UpdatedAt,
	)
	return err
}

// GetFilingBySourceID retrieves a filing by its source ID
func (db *DB) GetFilingBySourceID(ctx context.Context, exchangeType, sourceID string) (*models.Filing, error) {
	query := `SELECT id, company_id, source_id, exchange, filing_type, filing_sub_type,
			  report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			  file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at
			  FROM filings WHERE exchange = ? AND source_id = ?`

	var f models.Filing
	err := db.conn.QueryRowContext(ctx, query, exchangeType, sourceID).Scan(
		&f.ID, &f.CompanyID, &f.SourceID, &f.Exchange, &f.FilingType, &f.FilingSubType,
		&f.ReportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
		&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
		&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// UpdateFilingStatus updates the processing status of a filing
func (db *DB) UpdateFilingStatus(ctx context.Context, filingID string, status models.ProcessingStatus, errorMsg string) error {
	query := `UPDATE filings SET processing_status = ?, processing_error = ?, updated_at = ? WHERE id = ?`
	_, err := db.conn.ExecContext(ctx, query, status, errorMsg, time.Now(), filingID)
	return err
}

// InsertExtractedTable inserts an extracted table
func (db *DB) InsertExtractedTable(ctx context.Context, table *models.ExtractedTable) error {
	headersJSON, err := json.Marshal(table.Headers)
	if err != nil {
		return fmt.Errorf("marshaling headers: %w", err)
	}

	rowsJSON, err := json.Marshal(table.Rows)
	if err != nil {
		return fmt.Errorf("marshaling rows: %w", err)
	}

	positionJSON, err := json.Marshal(table.Position)
	if err != nil {
		return fmt.Errorf("marshaling position: %w", err)
	}

	query := `INSERT INTO extracted_tables (id, filing_id, page_number, table_index, headers, rows, position, confidence, created_at)
			  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`

	if table.CreatedAt.IsZero() {
		table.CreatedAt = time.Now()
	}

	_, err = db.conn.ExecContext(ctx, query,
		table.ID,
		table.FilingID,
		table.PageNumber,
		table.TableIndex,
		string(headersJSON),
		string(rowsJSON),
		string(positionJSON),
		table.Confidence,
		table.CreatedAt,
	)
	return err
}

// GetExtractedTables retrieves all tables for a filing
func (db *DB) GetExtractedTables(ctx context.Context, filingID string) ([]models.ExtractedTable, error) {
	query := `SELECT id, filing_id, page_number, table_index, headers, rows, position, confidence, created_at
			  FROM extracted_tables WHERE filing_id = ? ORDER BY page_number, table_index`

	rows, err := db.conn.QueryContext(ctx, query, filingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tables []models.ExtractedTable
	for rows.Next() {
		var t models.ExtractedTable
		var headersJSON, rowsJSON, positionJSON string

		if err := rows.Scan(&t.ID, &t.FilingID, &t.PageNumber, &t.TableIndex,
			&headersJSON, &rowsJSON, &positionJSON, &t.Confidence, &t.CreatedAt); err != nil {
			return nil, err
		}

		if err := json.Unmarshal([]byte(headersJSON), &t.Headers); err != nil {
			return nil, fmt.Errorf("unmarshaling headers: %w", err)
		}
		if err := json.Unmarshal([]byte(rowsJSON), &t.Rows); err != nil {
			return nil, fmt.Errorf("unmarshaling rows: %w", err)
		}
		if err := json.Unmarshal([]byte(positionJSON), &t.Position); err != nil {
			return nil, fmt.Errorf("unmarshaling position: %w", err)
		}

		tables = append(tables, t)
	}

	return tables, rows.Err()
}

// ListFilings retrieves filings with pagination
func (db *DB) ListFilings(ctx context.Context, limit, offset int) ([]models.Filing, error) {
	query := `SELECT id, company_id, source_id, exchange, filing_type, filing_sub_type,
			  report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			  file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at
			  FROM filings ORDER BY report_date DESC LIMIT ? OFFSET ?`

	rows, err := db.conn.QueryContext(ctx, query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filings []models.Filing
	for rows.Next() {
		var f models.Filing
		if err := rows.Scan(
			&f.ID, &f.CompanyID, &f.SourceID, &f.Exchange, &f.FilingType, &f.FilingSubType,
			&f.ReportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
			&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
			&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
		); err != nil {
			return nil, err
		}
		filings = append(filings, f)
	}

	return filings, rows.Err()
}

// CountFilings returns the total number of filings
func (db *DB) CountFilings(ctx context.Context) (int, error) {
	var count int
	err := db.conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM filings").Scan(&count)
	return count, err
}

// CountFilingsByStatus returns the number of filings with a specific status
func (db *DB) CountFilingsByStatus(ctx context.Context, status models.ProcessingStatus) (int, error) {
	var count int
	err := db.conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM filings WHERE processing_status = ?", status).Scan(&count)
	return count, err
}

// GetPendingFilings returns filings that need to be downloaded
func (db *DB) GetPendingFilings(ctx context.Context, limit int) ([]models.Filing, error) {
	query := `SELECT id, company_id, source_id, exchange, filing_type, filing_sub_type,
			  report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			  file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at
			  FROM filings WHERE processing_status = ? ORDER BY report_date DESC LIMIT ?`

	rows, err := db.conn.QueryContext(ctx, query, models.ProcessingStatusPending, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filings []models.Filing
	for rows.Next() {
		var f models.Filing
		if err := rows.Scan(
			&f.ID, &f.CompanyID, &f.SourceID, &f.Exchange, &f.FilingType, &f.FilingSubType,
			&f.ReportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
			&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
			&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
		); err != nil {
			return nil, err
		}
		filings = append(filings, f)
	}

	return filings, rows.Err()
}

// UpdateFilingDownload updates filing after successful download
func (db *DB) UpdateFilingDownload(ctx context.Context, filingID, localPath string) error {
	query := `UPDATE filings SET local_path = ?, processing_status = ?, updated_at = ? WHERE id = ?`
	_, err := db.conn.ExecContext(ctx, query, localPath, models.ProcessingStatusCompleted, time.Now(), filingID)
	return err
}

// UpdateFilingDownloadFull updates filing with local path, S3 key, status, and error
func (db *DB) UpdateFilingDownloadFull(ctx context.Context, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error {
	query := `UPDATE filings SET local_path = ?, pdf_s3_key = ?, processing_status = ?, processing_error = ?, updated_at = ? WHERE id = ?`
	_, err := db.conn.ExecContext(ctx, query, localPath, s3Key, status, errorMsg, time.Now(), filingID)
	return err
}

// GetFilingsByIDs retrieves filings by their IDs
func (db *DB) GetFilingsByIDs(ctx context.Context, ids []string) ([]models.Filing, error) {
	if len(ids) == 0 {
		return []models.Filing{}, nil
	}

	// Build placeholders for IN clause
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT id, company_id, source_id, exchange, filing_type, filing_sub_type,
		report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
		file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at
		FROM filings WHERE id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := db.conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var filings []models.Filing
	for rows.Next() {
		var f models.Filing
		if err := rows.Scan(
			&f.ID, &f.CompanyID, &f.SourceID, &f.Exchange, &f.FilingType, &f.FilingSubType,
			&f.ReportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
			&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
			&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
		); err != nil {
			return nil, err
		}
		filings = append(filings, f)
	}

	return filings, rows.Err()
}
