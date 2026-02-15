package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/aws/aws-lambda-go/lambda"
)

// Input is the Lambda event payload from Step Functions.
type Input struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	Market    string `json:"market"`
}

// Chunk represents a single monthly date range.
type Chunk struct {
	StartDate string `json:"start_date"`
	EndDate   string `json:"end_date"`
	Market    string `json:"market"`
}

// Output is returned to Step Functions.
type Output struct {
	Chunks []Chunk `json:"chunks"`
}

func Handler(ctx context.Context, input Input) (*Output, error) {
	if input.StartDate == "" || input.EndDate == "" {
		return nil, fmt.Errorf("start_date and end_date are required")
	}

	market := input.Market
	if market == "" {
		market = "SEHK"
	}

	start, err := time.Parse("2006-01-02", input.StartDate)
	if err != nil {
		return nil, fmt.Errorf("parsing start_date %q: %w", input.StartDate, err)
	}
	end, err := time.Parse("2006-01-02", input.EndDate)
	if err != nil {
		return nil, fmt.Errorf("parsing end_date %q: %w", input.EndDate, err)
	}

	if end.Before(start) {
		return nil, fmt.Errorf("end_date %s is before start_date %s", input.EndDate, input.StartDate)
	}

	var chunks []Chunk
	cursor := start
	for !cursor.After(end) {
		// End of this chunk: last day of cursor's month, or the overall end date
		chunkEnd := endOfMonth(cursor)
		if chunkEnd.After(end) {
			chunkEnd = end
		}

		chunks = append(chunks, Chunk{
			StartDate: cursor.Format("2006-01-02"),
			EndDate:   chunkEnd.Format("2006-01-02"),
			Market:    market,
		})

		// Advance to the first day of the next month
		cursor = chunkEnd.AddDate(0, 0, 1)
	}

	log.Printf("Generated %d monthly chunks from %s to %s (market=%s)", len(chunks), input.StartDate, input.EndDate, market)

	return &Output{Chunks: chunks}, nil
}

// endOfMonth returns the last day of the month for the given time.
func endOfMonth(t time.Time) time.Time {
	// Go to the first of next month, then subtract one day
	return time.Date(t.Year(), t.Month()+1, 1, 0, 0, 0, 0, t.Location()).AddDate(0, 0, -1)
}

func main() {
	lambda.Start(Handler)
}
