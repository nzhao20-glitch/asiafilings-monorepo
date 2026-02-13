package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"time"
)

// Test maximum rowRange for a whole month (October 2023)
func main() {
	client := &http.Client{Timeout: 120 * time.Second}

	// Test with full month of October 2023
	for _, rowRange := range []int{1000, 5000, 15000, 20000} {
		fmt.Printf("\n=== Testing rowRange=%d for October 2023 ===\n", rowRange)

		baseURL := "https://www1.hkexnews.hk/search/titleSearchServlet.do"
		queryParams := url.Values{}
		queryParams.Set("sortDir", "0")
		queryParams.Set("sortByOptions", "DateTime")
		queryParams.Set("category", "0")
		queryParams.Set("market", "SEHK")
		queryParams.Set("searchType", "0")
		queryParams.Set("documentType", "-1")
		queryParams.Set("fromDate", "20231001")
		queryParams.Set("toDate", "20231031")
		queryParams.Set("t1code", "-2")
		queryParams.Set("t2Gcode", "-2")
		queryParams.Set("t2code", "-2")
		queryParams.Set("rowRange", fmt.Sprintf("%d", rowRange))
		queryParams.Set("lang", "EN")

		fullURL := baseURL + "?" + queryParams.Encode()

		start := time.Now()
		resp, err := client.Get(fullURL)
		if err != nil {
			log.Printf("Error: %v", err)
			continue
		}
		defer resp.Body.Close()

		body, _ := io.ReadAll(resp.Body)
		elapsed := time.Since(start)

		var wrapper struct {
			Result       string `json:"result"`
			HasNextRow   bool   `json:"hasNextRow"`
			RowRange     int    `json:"rowRange"`
			LoadedRecord int    `json:"loadedRecord"`
			RecordCnt    int    `json:"recordCnt"`
		}
		json.Unmarshal(body, &wrapper)

		var results []struct {
			NewsID     string `json:"NEWS_ID"`
			TotalCount string `json:"TOTAL_COUNT"`
		}
		json.Unmarshal([]byte(wrapper.Result), &results)

		totalCount := 0
		if len(results) > 0 {
			fmt.Sscanf(results[0].TotalCount, "%d", &totalCount)
		}

		fmt.Printf("Time taken: %v\n", elapsed)
		fmt.Printf("Total available: %d\n", totalCount)
		fmt.Printf("Results returned: %d\n", len(results))
		fmt.Printf("HasNextRow: %v\n", wrapper.HasNextRow)

		// Check for unique IDs
		seen := make(map[string]bool)
		for _, r := range results {
			seen[r.NewsID] = true
		}
		fmt.Printf("Unique NewsIDs: %d\n", len(seen))

		if len(results) >= totalCount {
			fmt.Println("SUCCESS: Got all results!")
			break
		}
	}
}
