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

// GetCompanyByStockCode retrieves a company by stock code
func (db *PostgresDB) GetCompanyByStockCode(ctx context.Context, stockCode string) (*models.Company, error) {
	query := `SELECT id, stock_code, company_name, COALESCE(company_name_en, ''),
			  COALESCE(market_type, 'SEHK'), COALESCE(industry, ''), exchange, created_at, updated_at
			  FROM companies WHERE stock_code = $1`

	var c models.Company
	err := db.pool.QueryRow(ctx, query, stockCode).Scan(
		&c.ID, &c.StockCode, &c.CompanyName, &c.CompanyNameEn,
		&c.MarketType, &c.Industry, &c.Exchange, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}
	return &c, nil
}

// UpsertCompany creates or updates a company
func (db *PostgresDB) UpsertCompany(ctx context.Context, company *models.Company) error {
	query := `
		INSERT INTO companies (id, stock_code, company_name, company_name_en, market_type, industry, exchange, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT(stock_code) DO UPDATE SET
			company_name = EXCLUDED.company_name,
			company_name_en = EXCLUDED.company_name_en,
			market_type = EXCLUDED.market_type,
			industry = EXCLUDED.industry,
			updated_at = EXCLUDED.updated_at
	`

	now := time.Now()
	if company.CreatedAt.IsZero() {
		company.CreatedAt = now
	}
	company.UpdatedAt = now

	_, err := db.pool.Exec(ctx, query,
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

// GetFilingBySourceID retrieves a filing by its source ID
func (db *PostgresDB) GetFilingBySourceID(ctx context.Context, exchangeType, sourceID string) (*models.Filing, error) {
	query := `SELECT id, COALESCE(company_id, ''), source_id, exchange, COALESCE(filing_type, ''), COALESCE(filing_sub_type, ''),
			  report_date, COALESCE(title, ''), COALESCE(title_en, ''), COALESCE(source_url, ''), COALESCE(pdf_s3_key, ''), COALESCE(local_path, ''),
			  COALESCE(page_count, 0), COALESCE(file_size, 0), COALESCE(file_extension, ''), COALESCE(language, 'ZH'), COALESCE(processing_status, 'PENDING'),
			  COALESCE(processing_error, ''), ingested_at, created_at, updated_at
			  FROM filings WHERE exchange = $1 AND source_id = $2`

	var f models.Filing
	err := db.pool.QueryRow(ctx, query, exchangeType, sourceID).Scan(
		&f.ID, &f.CompanyID, &f.SourceID, &f.Exchange, &f.FilingType, &f.FilingSubType,
		&f.ReportDate, &f.Title, &f.TitleEn, &f.SourceURL, &f.PDFS3Key, &f.LocalPath,
		&f.PageCount, &f.FileSize, &f.FileExtension, &f.Language, &f.ProcessingStatus,
		&f.ProcessingError, &f.IngestedAt, &f.CreatedAt, &f.UpdatedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}
	return &f, nil
}

// UpsertFiling creates or updates a filing
func (db *PostgresDB) UpsertFiling(ctx context.Context, filing *models.Filing) error {
	query := `
		INSERT INTO filings (id, company_id, source_id, exchange, filing_type, filing_sub_type,
			report_date, title, title_en, source_url, pdf_s3_key, local_path, page_count, file_size,
			file_extension, language, processing_status, processing_error, ingested_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
		ON CONFLICT(exchange, source_id) DO UPDATE SET
			filing_type = EXCLUDED.filing_type,
			filing_sub_type = EXCLUDED.filing_sub_type,
			title = EXCLUDED.title,
			title_en = EXCLUDED.title_en,
			pdf_s3_key = EXCLUDED.pdf_s3_key,
			local_path = EXCLUDED.local_path,
			page_count = EXCLUDED.page_count,
			file_size = EXCLUDED.file_size,
			processing_status = EXCLUDED.processing_status,
			processing_error = EXCLUDED.processing_error,
			ingested_at = EXCLUDED.ingested_at,
			updated_at = EXCLUDED.updated_at
	`

	now := time.Now()
	if filing.CreatedAt.IsZero() {
		filing.CreatedAt = now
	}
	filing.UpdatedAt = now

	_, err := db.pool.Exec(ctx, query,
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
