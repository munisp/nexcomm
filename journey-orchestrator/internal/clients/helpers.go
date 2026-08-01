package clients

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// PostRaw posts a JSON body and discards the response body (only checks status code).
func (c *Client) PostRaw(ctx context.Context, url string, body interface{}) error {
	return c.post(ctx, url, body, nil)
}

// PostRawResult posts a JSON body and unmarshals the response into result.
func (c *Client) PostRawResult(ctx context.Context, url string, body interface{}, result interface{}) error {
	return c.post(ctx, url, body, result)
}

// GetRaw performs a GET request and discards the response body (only checks status code).
func (c *Client) GetRaw(ctx context.Context, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("GET %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("GET %s returned %d: %s", url, resp.StatusCode, string(data))
	}
	return nil
}

// GetJSON performs a GET request and unmarshals the response into result.
func (c *Client) GetJSON(ctx context.Context, url string, result interface{}) error {
	return c.get(ctx, url, result)
}

// PatchRaw performs a PATCH request with a JSON body.
func (c *Client) PatchRaw(ctx context.Context, url string, body interface{}) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, url, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("PATCH %s: %w", url, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return fmt.Errorf("PATCH %s returned %d: %s", url, resp.StatusCode, string(data))
	}
	return nil
}
