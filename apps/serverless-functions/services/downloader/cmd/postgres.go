package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// PostgresDB wraps a PostgreSQL connection pool
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

// GetFilingsByIDs retrieves filings by their IDs
func (db *PostgresDB) GetFilingsByIDs(ctx context.Context, ids []string) ([]models.Filing, error) {
	if len(ids) == 0 {
		return []models.Filing{}, nil
	}

	// Build placeholders for IN clause ($1, $2, ...)
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = id
	}

	query := fmt.Sprintf(`SELECT source_id, COALESCE(company_id, ''), source_id, exchange, COALESCE(filing_type, ''), COALESCE(filing_sub_type, ''),
		report_date, COALESCE(title, ''), COALESCE(title_en, ''), COALESCE(source_url, ''), COALESCE(pdf_s3_key, ''), COALESCE(local_path, ''),
		COALESCE(page_count, 0), COALESCE(file_size, 0), COALESCE(file_extension, ''), COALESCE(language, ''), COALESCE(processing_status, 'PENDING'),
		COALESCE(processing_error, ''), COALESCE(ingested_at, created_at), created_at, updated_at
		FROM filings WHERE source_id IN (%s)`, strings.Join(placeholders, ","))

	rows, err := db.pool.Query(ctx, query, args...)
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

// GetPendingFilings retrieves filings with PENDING status
func (db *PostgresDB) GetPendingFilings(ctx context.Context, limit int) ([]models.Filing, error) {
	query := `SELECT source_id, COALESCE(company_id, ''), source_id, exchange, COALESCE(filing_type, ''), COALESCE(filing_sub_type, ''),
		report_date, COALESCE(title, ''), COALESCE(title_en, ''), COALESCE(source_url, ''), COALESCE(pdf_s3_key, ''), COALESCE(local_path, ''),
		COALESCE(page_count, 0), COALESCE(file_size, 0), COALESCE(file_extension, ''), COALESCE(language, ''), COALESCE(processing_status, 'PENDING'),
		COALESCE(processing_error, ''), COALESCE(ingested_at, created_at), created_at, updated_at
		FROM filings WHERE processing_status = $1 ORDER BY report_date DESC LIMIT $2`

	rows, err := db.pool.Query(ctx, query, models.ProcessingStatusPending, limit)
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

// UpdateFilingDownloadFull updates a filing after download attempt
func (db *PostgresDB) UpdateFilingDownloadFull(ctx context.Context, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error {
	query := `UPDATE filings SET local_path = $1, pdf_s3_key = $2, processing_status = $3,
		processing_error = $4, updated_at = $5 WHERE source_id = $6`

	_, err := db.pool.Exec(ctx, query, localPath, s3Key, status, errorMsg, time.Now(), filingID)
	return err
}

// GetPendingFilingIDs retrieves IDs of pending filings
func (db *PostgresDB) GetPendingFilingIDs(ctx context.Context, limit int) ([]string, error) {
	query := `SELECT source_id FROM filings WHERE processing_status = $1 ORDER BY report_date DESC LIMIT $2`

	rows, err := db.pool.Query(ctx, query, models.ProcessingStatusPending, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}

	return ids, rows.Err()
}

// CountFilingsByStatus returns the count of filings by status
func (db *PostgresDB) CountFilingsByStatus(ctx context.Context, status models.ProcessingStatus) (int, error) {
	var count int
	err := db.pool.QueryRow(ctx, "SELECT COUNT(*) FROM filings WHERE processing_status = $1", status).Scan(&count)
	return count, err
}

// BatchUpdateFilingStatus updates multiple filings to PROCESSING status
func (db *PostgresDB) BatchUpdateFilingStatus(ctx context.Context, ids []string, status models.ProcessingStatus) error {
	if len(ids) == 0 {
		return nil
	}

	batch := &pgx.Batch{}
	for _, id := range ids {
		batch.Queue("UPDATE filings SET processing_status = $1, updated_at = $2 WHERE source_id = $3",
			status, time.Now(), id)
	}

	br := db.pool.SendBatch(ctx, batch)
	defer br.Close()

	for i := 0; i < len(ids); i++ {
		if _, err := br.Exec(); err != nil {
			return err
		}
	}

	return nil
}

// UpdateFilingStatus updates just the status and error message for a filing
func (db *PostgresDB) UpdateFilingStatus(ctx context.Context, filingID string, status models.ProcessingStatus, errorMsg string) error {
	query := `UPDATE filings SET processing_status = $1, processing_error = $2, updated_at = $3 WHERE source_id = $4`
	_, err := db.pool.Exec(ctx, query, status, errorMsg, time.Now(), filingID)
	return err
}
