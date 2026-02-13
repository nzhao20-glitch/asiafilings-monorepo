package downloader

import (
	"context"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// DBStore adapts a database connection to the FilingStore interface
type DBStore struct {
	db DBInterface
}

// DBInterface defines the database methods needed by the downloader
type DBInterface interface {
	GetFilingsByIDs(ctx context.Context, ids []string) ([]models.Filing, error)
	GetPendingFilings(ctx context.Context, limit int) ([]models.Filing, error)
	UpdateFilingDownloadFull(ctx context.Context, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error
	UpdateFilingStatus(ctx context.Context, filingID string, status models.ProcessingStatus, errorMsg string) error
}

// NewDBStore creates a new database store adapter
func NewDBStore(db DBInterface) *DBStore {
	return &DBStore{db: db}
}

// GetFilingsByIDs retrieves filings by their IDs
func (s *DBStore) GetFilingsByIDs(ctx context.Context, ids []string) ([]models.Filing, error) {
	return s.db.GetFilingsByIDs(ctx, ids)
}

// GetPendingFilings retrieves filings with PENDING status
func (s *DBStore) GetPendingFilings(ctx context.Context, limit int) ([]models.Filing, error) {
	return s.db.GetPendingFilings(ctx, limit)
}

// UpdateFilingDownload updates a filing after download attempt
func (s *DBStore) UpdateFilingDownload(ctx context.Context, filingID, localPath, s3Key string, status models.ProcessingStatus, errorMsg string) error {
	return s.db.UpdateFilingDownloadFull(ctx, filingID, localPath, s3Key, status, errorMsg)
}

// SetProcessing marks a filing as PROCESSING before download starts
func (s *DBStore) SetProcessing(ctx context.Context, filingID string) error {
	return s.db.UpdateFilingStatus(ctx, filingID, models.ProcessingStatusProcessing, "")
}

// BatchSetProcessing marks multiple filings as PROCESSING
func (s *DBStore) BatchSetProcessing(ctx context.Context, filingIDs []string) error {
	for _, id := range filingIDs {
		if err := s.SetProcessing(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
