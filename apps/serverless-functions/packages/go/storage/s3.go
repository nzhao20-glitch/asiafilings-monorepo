package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/nicholaszhao/hkex-scraper/packages/go/models"
)

// S3Storage implements Storage for AWS S3
type S3Storage struct {
	client *s3.Client
	bucket string
	prefix string
}

// NewS3Storage creates a new S3 storage instance
func NewS3Storage(ctx context.Context, bucket, region, prefix string) (*S3Storage, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	client := s3.NewFromConfig(cfg)

	return &S3Storage{
		client: client,
		bucket: bucket,
		prefix: prefix,
	}, nil
}

// Save stores a document to S3
func (s *S3Storage) Save(ctx context.Context, announcement *models.Announcement, data []byte) (string, error) {
	key := s.objectKey(announcement)

	contentType := "application/octet-stream"
	if announcement.IsPDF() {
		contentType = "application/pdf"
	} else if announcement.IsHTML() {
		contentType = "text/html"
	}

	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(contentType),
	})
	if err != nil {
		return "", fmt.Errorf("uploading to S3: %w", err)
	}

	return fmt.Sprintf("s3://%s/%s", s.bucket, key), nil
}

// Exists checks if a document already exists in S3
func (s *S3Storage) Exists(ctx context.Context, announcement *models.Announcement) (bool, error) {
	key := s.objectKey(announcement)

	_, err := s.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		var notFound *types.NotFound
		if errors.As(err, &notFound) {
			return false, nil
		}
		return false, fmt.Errorf("checking S3 object: %w", err)
	}

	return true, nil
}

// Get retrieves a document from S3
func (s *S3Storage) Get(ctx context.Context, announcement *models.Announcement) ([]byte, error) {
	key := s.objectKey(announcement)

	resp, err := s.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("getting S3 object: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading S3 object body: %w", err)
	}

	return data, nil
}

func (s *S3Storage) objectKey(announcement *models.Announcement) string {
	path := DocumentPath(announcement)
	if s.prefix != "" {
		return s.prefix + "/" + path
	}
	return path
}
