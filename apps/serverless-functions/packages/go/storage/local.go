package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// LocalStorage implements Storage for local filesystem
type LocalStorage struct {
	basePath string
}

// NewLocalStorage creates a new local storage instance
func NewLocalStorage(basePath string) (*LocalStorage, error) {
	// Create base directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("creating base directory: %w", err)
	}

	return &LocalStorage{
		basePath: basePath,
	}, nil
}

// Save stores a document to the local filesystem
func (s *LocalStorage) Save(ctx context.Context, announcement *models.Announcement, data []byte) (string, error) {
	relPath := DocumentPath(announcement)
	fullPath := filepath.Join(s.basePath, relPath)

	// Create parent directories
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("creating directory %s: %w", dir, err)
	}

	// Write the file
	if err := os.WriteFile(fullPath, data, 0644); err != nil {
		return "", fmt.Errorf("writing file %s: %w", fullPath, err)
	}

	return fullPath, nil
}

// Exists checks if a document already exists in local storage
func (s *LocalStorage) Exists(ctx context.Context, announcement *models.Announcement) (bool, error) {
	relPath := DocumentPath(announcement)
	fullPath := filepath.Join(s.basePath, relPath)

	_, err := os.Stat(fullPath)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, fmt.Errorf("checking file %s: %w", fullPath, err)
}

// Get retrieves a document from local storage
func (s *LocalStorage) Get(ctx context.Context, announcement *models.Announcement) ([]byte, error) {
	relPath := DocumentPath(announcement)
	fullPath := filepath.Join(s.basePath, relPath)

	data, err := os.ReadFile(fullPath)
	if err != nil {
		return nil, fmt.Errorf("reading file %s: %w", fullPath, err)
	}

	return data, nil
}

// BasePath returns the base path for local storage
func (s *LocalStorage) BasePath() string {
	return s.basePath
}
