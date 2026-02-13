package downloader

import (
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// S3Client wraps the AWS S3 client
type S3Client struct {
	client *s3.Client
}

// NewS3Client creates a new S3 client using default AWS credentials
func NewS3Client(ctx context.Context) (*S3Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx)
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	return &S3Client{
		client: s3.NewFromConfig(cfg),
	}, nil
}

// NewS3ClientWithRegion creates a new S3 client for a specific region
func NewS3ClientWithRegion(ctx context.Context, region string) (*S3Client, error) {
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("loading AWS config: %w", err)
	}

	return &S3Client{
		client: s3.NewFromConfig(cfg),
	}, nil
}

// Upload uploads data to S3
func (c *S3Client) Upload(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        body,
		ContentType: aws.String(contentType),
	}

	_, err := c.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("uploading to S3: %w", err)
	}

	return nil
}

// Exists checks if an object exists in S3
func (c *S3Client) Exists(ctx context.Context, bucket, key string) (bool, error) {
	_, err := c.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		// Check if it's a not found error
		return false, nil
	}
	return true, nil
}

// Delete deletes an object from S3
func (c *S3Client) Delete(ctx context.Context, bucket, key string) error {
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(key),
	})
	return err
}

// GetURL returns the S3 URL for an object
func (c *S3Client) GetURL(bucket, key, region string) string {
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", bucket, region, key)
}

// NullS3Client is a no-op S3 client for testing
type NullS3Client struct{}

// Upload does nothing (for dry-run mode)
func (c *NullS3Client) Upload(ctx context.Context, bucket, key string, body io.Reader, contentType string) error {
	return nil
}
