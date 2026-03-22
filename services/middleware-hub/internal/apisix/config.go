// Package apisix provides APISIX API Gateway configuration management for NEXCOM.
// Manages route definitions, upstream configurations, plugin settings, and consumer credentials.
// Uses the APISIX Admin API to dynamically configure routing rules.
package apisix

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"go.uber.org/zap"
)

// APISIX Admin API paths
const (
	PathRoutes    = "/apisix/admin/routes"
	PathUpstreams = "/apisix/admin/upstreams"
	PathPlugins   = "/apisix/admin/plugins"
	PathConsumers = "/apisix/admin/consumers"
	PathSSL       = "/apisix/admin/ssl"
)

// Route represents an APISIX route definition
type Route struct {
	ID         string                 `json:"id"`
	Name       string                 `json:"name"`
	URI        string                 `json:"uri"`
	Methods    []string               `json:"methods"`
	UpstreamID string                 `json:"upstream_id,omitempty"`
	Upstream   *Upstream              `json:"upstream,omitempty"`
	Plugins    map[string]interface{} `json:"plugins,omitempty"`
	Priority   int                    `json:"priority,omitempty"`
	Status     int                    `json:"status"` // 1=enabled, 0=disabled
}

// Upstream represents an APISIX upstream (backend service)
type Upstream struct {
	ID     string            `json:"id,omitempty"`
	Name   string            `json:"name,omitempty"`
	Type   string            `json:"type"` // roundrobin | least_conn | ewma
	Nodes  map[string]int    `json:"nodes"` // host:port -> weight
	Scheme string            `json:"scheme"` // http | https | grpc
	Checks *HealthCheck      `json:"checks,omitempty"`
}

// HealthCheck defines upstream health check configuration
type HealthCheck struct {
	Active *ActiveCheck `json:"active,omitempty"`
}

// ActiveCheck defines active health check parameters
type ActiveCheck struct {
	Type        string   `json:"type"` // http | https
	HTTPPath    string   `json:"http_path"`
	Interval    int      `json:"interval"`    // seconds
	Timeout     int      `json:"timeout"`     // seconds
	Concurrency int      `json:"concurrency"`
	Healthy     Threshold `json:"healthy"`
	Unhealthy   Threshold `json:"unhealthy"`
}

// Threshold defines health check thresholds
type Threshold struct {
	Interval     int `json:"interval"`
	Successes    int `json:"successes"`
	HTTPFailures int `json:"http_failures"`
	TCPFailures  int `json:"tcp_failures"`
}

// Client manages APISIX configuration via Admin API
type Client struct {
	httpClient *http.Client
	adminURL   string
	apiKey     string
	logger     *zap.SugaredLogger
}

// NewClient creates a new APISIX admin client
func NewClient(logger *zap.SugaredLogger) *Client {
	adminURL := os.Getenv("APISIX_ADMIN_URL")
	if adminURL == "" {
		adminURL = "http://localhost:9180"
	}
	apiKey := os.Getenv("APISIX_ADMIN_KEY")
	if apiKey == "" {
		apiKey = "nexcom-apisix-admin-key"
	}
	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		adminURL:   adminURL,
		apiKey:     apiKey,
		logger:     logger,
	}
}

// adminRequest performs an authenticated APISIX Admin API request
func (c *Client) adminRequest(ctx context.Context, method string, path string, body interface{}) (map[string]interface{}, error) {
	var bodyReader *strings.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal error: %w", err)
		}
		bodyReader = strings.NewReader(string(data))
	} else {
		bodyReader = strings.NewReader("")
	}

	req, err := http.NewRequestWithContext(ctx, method,
		fmt.Sprintf("%s%s", c.adminURL, path),
		bodyReader,
	)
	if err != nil {
		return nil, fmt.Errorf("request creation error: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-API-KEY", c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("apisix admin error: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("apisix admin returned status %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode error: %w", err)
	}

	return result, nil
}

// CreateUpstream creates or updates an upstream in APISIX
func (c *Client) CreateUpstream(ctx context.Context, upstream Upstream) error {
	_, err := c.adminRequest(ctx, http.MethodPut,
		fmt.Sprintf("%s/%s", PathUpstreams, upstream.ID),
		upstream,
	)
	if err != nil {
		return fmt.Errorf("create upstream error: %w", err)
	}
	c.logger.Infow("Created APISIX upstream", "id", upstream.ID, "name", upstream.Name)
	return nil
}

// CreateRoute creates or updates a route in APISIX
func (c *Client) CreateRoute(ctx context.Context, route Route) error {
	_, err := c.adminRequest(ctx, http.MethodPut,
		fmt.Sprintf("%s/%s", PathRoutes, route.ID),
		route,
	)
	if err != nil {
		return fmt.Errorf("create route error: %w", err)
	}
	c.logger.Infow("Created APISIX route", "id", route.ID, "uri", route.URI)
	return nil
}

// DeleteRoute removes a route from APISIX
func (c *Client) DeleteRoute(ctx context.Context, routeID string) error {
	_, err := c.adminRequest(ctx, http.MethodDelete,
		fmt.Sprintf("%s/%s", PathRoutes, routeID),
		nil,
	)
	return err
}

// BootstrapNEXCOMRoutes configures all NEXCOM service routes in APISIX
func (c *Client) BootstrapNEXCOMRoutes(ctx context.Context) error {
	// Define all NEXCOM service upstreams
	upstreams := []Upstream{
		{
			ID:     "nexcom-web-portal",
			Name:   "NEXCOM Web Portal",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:3000": 1},
			Checks: &HealthCheck{Active: &ActiveCheck{
				Type: "http", HTTPPath: "/api/health",
				Interval: 10, Timeout: 5, Concurrency: 2,
				Healthy:   Threshold{Interval: 2, Successes: 2},
				Unhealthy: Threshold{Interval: 1, HTTPFailures: 3},
			}},
		},
		{
			ID:     "nexcom-kyc-service",
			Name:   "KYC/AML Service",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:3002": 1},
			Checks: &HealthCheck{Active: &ActiveCheck{
				Type: "http", HTTPPath: "/health",
				Interval: 15, Timeout: 5, Concurrency: 1,
				Healthy:   Threshold{Interval: 2, Successes: 2},
				Unhealthy: Threshold{Interval: 1, HTTPFailures: 3},
			}},
		},
		{
			ID:     "nexcom-blockchain",
			Name:   "Blockchain Service",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:8004": 1},
		},
		{
			ID:     "nexcom-risk",
			Name:   "Risk Management Service",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:8005": 1},
		},
		{
			ID:     "nexcom-analytics",
			Name:   "Analytics Engine",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:8009": 1},
		},
		{
			ID:     "nexcom-mojaloop",
			Name:   "Mojaloop DFSP Adapter",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:4001": 1},
		},
		{
			ID:     "nexcom-middleware-hub",
			Name:   "Middleware Hub",
			Type:   "roundrobin",
			Scheme: "http",
			Nodes:  map[string]int{"localhost:8020": 1},
		},
	}

	for _, upstream := range upstreams {
		if err := c.CreateUpstream(ctx, upstream); err != nil {
			c.logger.Warnw("Failed to create upstream (APISIX may be unavailable)", "id", upstream.ID, "error", err)
		}
	}

	// JWT validation plugin config (Keycloak)
	jwtPlugin := map[string]interface{}{
		"jwt-auth": map[string]interface{}{
			"key":       "nexcom-jwt",
			"algorithm": "RS256",
		},
	}

	// Rate limiting plugin config
	rateLimitPlugin := map[string]interface{}{
		"limit-req": map[string]interface{}{
			"rate":  100,
			"burst": 200,
			"key":   "consumer_name",
		},
	}

	// CORS plugin config
	corsPlugin := map[string]interface{}{
		"cors": map[string]interface{}{
			"allow_origins": "*",
			"allow_methods": "GET,POST,PUT,DELETE,PATCH,OPTIONS",
			"allow_headers": "Authorization,Content-Type,X-Requested-With",
			"max_age":       3600,
		},
	}

	// Prometheus metrics plugin
	prometheusPlugin := map[string]interface{}{
		"prometheus": map[string]interface{}{
			"prefer_name": true,
		},
	}

	// Define all routes
	routes := []Route{
		// tRPC API — all procedures
		{
			ID: "nexcom-trpc", Name: "NEXCOM tRPC API",
			URI: "/api/trpc/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-web-portal",
			Plugins:    mergePlugins(rateLimitPlugin, corsPlugin, prometheusPlugin),
			Status:     1,
		},
		// OAuth callback
		{
			ID: "nexcom-oauth", Name: "OAuth Callback",
			URI: "/api/oauth/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-web-portal",
			Plugins:    mergePlugins(corsPlugin),
			Status:     1,
		},
		// KYC Service API
		{
			ID: "nexcom-kyc-api", Name: "KYC Service API",
			URI: "/api/kyc/*", Methods: []string{"GET", "POST", "PUT"},
			UpstreamID: "nexcom-kyc-service",
			Plugins:    mergePlugins(jwtPlugin, rateLimitPlugin, prometheusPlugin),
			Status:     1,
		},
		// Blockchain Service API
		{
			ID: "nexcom-blockchain-api", Name: "Blockchain Service API",
			URI: "/api/blockchain/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-blockchain",
			Plugins:    mergePlugins(jwtPlugin, rateLimitPlugin, prometheusPlugin),
			Status:     1,
		},
		// Risk Management API
		{
			ID: "nexcom-risk-api", Name: "Risk Management API",
			URI: "/api/risk/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-risk",
			Plugins:    mergePlugins(jwtPlugin, prometheusPlugin),
			Status:     1,
		},
		// Analytics API
		{
			ID: "nexcom-analytics-api", Name: "Analytics Engine API",
			URI: "/api/analytics/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-analytics",
			Plugins:    mergePlugins(jwtPlugin, rateLimitPlugin, prometheusPlugin),
			Status:     1,
		},
		// Mojaloop FSPIOP callbacks (no JWT — uses FSPIOP signature verification)
		{
			ID: "nexcom-mojaloop-callbacks", Name: "Mojaloop FSPIOP Callbacks",
			URI: "/fspiop/*", Methods: []string{"GET", "POST", "PUT"},
			UpstreamID: "nexcom-mojaloop",
			Plugins:    mergePlugins(prometheusPlugin),
			Status:     1,
		},
		// Middleware Hub health and control
		{
			ID: "nexcom-middleware-health", Name: "Middleware Hub Health",
			URI: "/middleware/*", Methods: []string{"GET", "POST"},
			UpstreamID: "nexcom-middleware-hub",
			Plugins:    mergePlugins(jwtPlugin, prometheusPlugin),
			Status:     1,
		},
	}

	for _, route := range routes {
		if err := c.CreateRoute(ctx, route); err != nil {
			c.logger.Warnw("Failed to create route (APISIX may be unavailable)", "id", route.ID, "error", err)
		}
	}

	c.logger.Infow("NEXCOM APISIX routes bootstrapped",
		"upstreams", len(upstreams),
		"routes", len(routes),
	)
	return nil
}

// mergePlugins merges multiple plugin maps into one
func mergePlugins(maps ...map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for _, m := range maps {
		for k, v := range m {
			result[k] = v
		}
	}
	return result
}

// HealthCheck verifies APISIX Admin API connectivity
func (c *Client) HealthCheck(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		fmt.Sprintf("%s/apisix/admin/routes", c.adminURL),
		nil,
	)
	if err != nil {
		return false
	}
	req.Header.Set("X-API-KEY", c.apiKey)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
