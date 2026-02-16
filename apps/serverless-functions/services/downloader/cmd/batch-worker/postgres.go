package main

import (
	"context"
	"fmt"
	"time"

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

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pinging database: %w", err)
	}

	return &PostgresDB{pool: pool}, nil
}

// Close closes the database connection
func (db *PostgresDB) Close() {
	db.pool.Close()
}

// UpdateFilingDownloadFull updates a filing after a download attempt.
// Uses composite PK (exchange, source_id) for the WHERE clause.
func (db *PostgresDB) UpdateFilingDownloadFull(ctx context.Context, exchange, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error {
	query := `UPDATE filings SET local_path = $1, pdf_s3_key = $2, processing_status = $3,
		processing_error = $4, updated_at = $5 WHERE exchange = $6 AND source_id = $7`

	_, err := db.pool.Exec(ctx, query, localPath, s3Key, status, errorMsg, time.Now(), exchange, filingID)
	return err
}
