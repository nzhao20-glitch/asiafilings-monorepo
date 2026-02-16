package main

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// PostgresDB wraps a PostgreSQL connection pool for the scraper
type PostgresDB struct {
	pool *pgxpool.Pool
}

// NewPostgresDB creates a new PostgreSQL connection
func NewPostgresDB(ctx context.Context, dsn string) (*PostgresDB, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("creating connection pool: %w", err)
	}

	// Test connection
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	return &PostgresDB{pool: pool}, nil
}

// Close closes the database connection
func (db *PostgresDB) Close() {
	db.pool.Close()
}

// GetCompanyByStockCode retrieves a company by stock code.
// Schema: companies(company_id, name, stock_code, exchange, updated_at)
// PK: (exchange, company_id)
func (db *PostgresDB) GetCompanyByStockCode(ctx context.Context, stockCode string) (*models.Company, error) {
	query := `SELECT company_id, COALESCE(stock_code, ''), name, exchange, updated_at
			  FROM companies WHERE stock_code = $1 AND exchange = 'HKEX'`

	var c models.Company
	err := db.pool.QueryRow(ctx, query, stockCode).Scan(
		&c.ID, &c.StockCode, &c.CompanyName, &c.Exchange, &c.UpdatedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// UpsertCompany creates or updates a company.
// Schema: companies(company_id, name, stock_code, exchange, updated_at)
// PK: (exchange, company_id)
func (db *PostgresDB) UpsertCompany(ctx context.Context, company *models.Company) error {
	query := `
		INSERT INTO companies (company_id, name, stock_code, exchange, updated_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT(exchange, company_id) DO UPDATE SET
			name = EXCLUDED.name,
			stock_code = EXCLUDED.stock_code,
			updated_at = EXCLUDED.updated_at
	`

	company.UpdatedAt = time.Now()

	_, err := db.pool.Exec(ctx, query,
		company.ID,
		company.CompanyName,
		company.StockCode,
		company.Exchange,
		company.UpdatedAt,
	)
	return err
}

// GetFilingBySourceID retrieves a filing by its source ID.
// Schema: filings(exchange, source_id, company_id, title, title_en, source_url, pdf_s3_key,
//   filing_type, filing_sub_type, local_path, file_extension, page_count, file_size,
//   language, processing_status, processing_error, ingested_at, report_date, created_at, updated_at, ...)
// PK: (exchange, source_id)
func (db *PostgresDB) GetFilingBySourceID(ctx context.Context, exchangeType, sourceID string) (*models.Filing, error) {
	query := `SELECT source_id, exchange, COALESCE(company_id, ''), COALESCE(filing_type, ''), COALESCE(filing_sub_type, ''),
			  report_date, COALESCE(title, ''), COALESCE(title_en, ''), COALESCE(source_url, ''), COALESCE(pdf_s3_key, ''), COALESCE(local_path, ''),
			  COALESCE(page_count, 0), COALESCE(file_size, 0), COALESCE(file_extension, ''), COALESCE(language, 'ZH'), COALESCE(processing_status, 'PENDING'),
			  COALESCE(processing_error, ''), ingested_at, created_at, COALESCE(updated_at, created_at)
			  FROM filings WHERE exchange = $1 AND source_id = $2`

	var f models.Filing
	var reportDate *time.Time
	err := db.pool.QueryRow(ctx, query, exchangeType, sourceID).Scan(
		&f.SourceID, &f.Exchange, &f.CompanyID, &f.FilingType, &f.FilingSubType,
		&reportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
		&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
		&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
	)
	if reportDate != nil {
		f.ReportDate = *reportDate
	}
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}
	// Use composite key as ID for internal reference
	f.ID = f.Exchange + ":" + f.SourceID
	return &f, nil
}

// UpsertFiling creates or updates a filing.
// Schema PK: (exchange, source_id) — no separate id column.
func (db *PostgresDB) UpsertFiling(ctx context.Context, filing *models.Filing) error {
	query := `
		INSERT INTO filings (source_id, exchange, company_id, filing_type, filing_sub_type,
			report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
		ON CONFLICT(exchange, source_id) DO UPDATE SET
			company_id = EXCLUDED.company_id,
			filing_type = EXCLUDED.filing_type,
			filing_sub_type = EXCLUDED.filing_sub_type,
			title = EXCLUDED.title,
			title_en = EXCLUDED.title_en,
			source_url = EXCLUDED.source_url,
			file_extension = EXCLUDED.file_extension,
			language = EXCLUDED.language,
			ingested_at = EXCLUDED.ingested_at,
			updated_at = EXCLUDED.updated_at
	`

	now := time.Now()
	if filing.CreatedAt.IsZero() {
		filing.CreatedAt = now
	}
	filing.UpdatedAt = now

	_, err := db.pool.Exec(ctx, query,
		filing.SourceID,
		filing.Exchange,
		filing.CompanyID,
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
