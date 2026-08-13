package permify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var ErrUnavailable = errors.New("permify unavailable")

// Client wraps the Permify permission API. Authorization is deliberately
// Permission checks are fail-closed and never use a process-local tuple cache.
type Client struct {
	endpoint    string
	tenantID    string
	authToken   string
	requireAuth bool
	connected   bool
	mu          sync.RWMutex
	httpClient  *http.Client
}

type PermissionCheck struct {
	Entity     string `json:"entity"`
	EntityID   string `json:"entityId"`
	Permission string `json:"permission"`
	Subject    string `json:"subject"`
	SubjectID  string `json:"subjectId"`
}

type RelationshipTuple struct {
	EntityType  string `json:"entityType"`
	EntityID    string `json:"entityId"`
	Relation    string `json:"relation"`
	SubjectType string `json:"subjectType"`
	SubjectID   string `json:"subjectId"`
}

// NewClient is retained for explicitly isolated unit tests that do not perform
// authenticated production authorization requests. Runtime code must use
// NewAuthenticatedClient.
func NewClient(endpoint string) *Client {
	return newClient(endpoint, "nexcom", "", false)
}

// NewAuthenticatedClient is the production constructor. A missing token leaves
// the client disconnected so protected callers fail closed.
func NewAuthenticatedClient(endpoint, tenantID, authToken string) *Client {
	return newClient(endpoint, tenantID, authToken, true)
}

func newClient(endpoint, tenantID, authToken string, requireAuth bool) *Client {
	if strings.TrimSpace(tenantID) == "" {
		tenantID = "nexcom"
	}
	c := &Client{
		endpoint:    strings.TrimRight(endpoint, "/"),
		tenantID:    tenantID,
		authToken:   strings.TrimSpace(authToken),
		requireAuth: requireAuth,
		httpClient:  &http.Client{Timeout: 5 * time.Second},
	}
	_ = c.connect()
	return c
}

func (c *Client) baseURL() string {
	if strings.HasPrefix(c.endpoint, "http://") || strings.HasPrefix(c.endpoint, "https://") {
		return c.endpoint
	}
	return "http://" + c.endpoint
}

func (c *Client) connect() error {
	if c.requireAuth && !strings.HasPrefix(c.endpoint, "https://") {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return errors.New("Permify authenticated endpoint must use HTTPS")
	}
	if c.requireAuth && c.authToken == "" {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return errors.New("Permify authentication token is required")
	}
	address := strings.TrimPrefix(strings.TrimPrefix(c.endpoint, "http://"), "https://")
	conn, err := net.DialTimeout("tcp", address, 3*time.Second)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: cannot reach %s: %v", ErrUnavailable, c.endpoint, err)
	}
	_ = conn.Close()
	c.mu.Lock()
	c.connected = true
	c.mu.Unlock()
	return nil
}

func (c *Client) ensureConnected() error {
	c.mu.RLock()
	connected := c.connected
	c.mu.RUnlock()
	if connected {
		return nil
	}
	return c.connect()
}

func (c *Client) post(path string, payload interface{}, out interface{}) error {
	if err := c.ensureConnected(); err != nil {
		return err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequest(http.MethodPost, c.baseURL()+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build Permify request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if c.requireAuth {
		if c.authToken == "" {
			return errors.New("Permify authentication token is required")
		}
		req.Header.Set("Authorization", "Bearer "+c.authToken)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: request to %s failed: %v", ErrUnavailable, path, err)
	}
	defer resp.Body.Close()
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 128*1024))
	if readErr != nil {
		return readErr
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Permify %s returned HTTP %d: %s", path, resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	if out != nil {
		if err := json.Unmarshal(responseBody, out); err != nil {
			return fmt.Errorf("decode Permify %s response: %w", path, err)
		}
	}
	return nil
}

// Check verifies a permission against Permify. A service or transport failure
// is an error, never an implicit permission grant.
func (c *Client) Check(entityType, entityID, permission, subjectType, subjectID string) (bool, error) {
	if entityType == "" || entityID == "" || permission == "" || subjectType == "" || subjectID == "" {
		return false, errors.New("Permify permission check requires entity, permission, and subject")
	}
	request := map[string]interface{}{
		"metadata":   map[string]interface{}{"schema_version": "", "snap_token": "", "depth": 20},
		"entity":     map[string]string{"type": entityType, "id": entityID},
		"permission": permission,
		"subject":    map[string]string{"type": subjectType, "id": subjectID},
	}
	var result struct {
		Can string `json:"can"`
	}
	if err := c.post(c.tenantPath("permissions/check"), request, &result); err != nil {
		return false, err
	}
	switch result.Can {
	case "CHECK_RESULT_ALLOWED":
		return true, nil
	case "CHECK_RESULT_DENIED", "CHECK_RESULT_UNSPECIFIED", "":
		return false, nil
	default:
		return false, fmt.Errorf("unknown Permify check result %q", result.Can)
	}
}

func (c *Client) WriteRelationship(entityType, entityID, relation, subjectType, subjectID string) error {
	request := map[string]interface{}{
		"metadata": map[string]interface{}{"schema_version": ""},
		"tuples": []map[string]interface{}{{
			"entity":   map[string]string{"type": entityType, "id": entityID},
			"relation": relation,
			"subject":  map[string]string{"type": subjectType, "id": subjectID},
		}},
	}
	return c.post(c.tenantPath("relationships/write"), request, nil)
}

func (c *Client) DeleteRelationship(entityType, entityID, relation, subjectType, subjectID string) error {
	request := map[string]interface{}{
		"metadata": map[string]interface{}{"schema_version": ""},
		"tuples": []map[string]interface{}{{
			"entity":   map[string]string{"type": entityType, "id": entityID},
			"relation": relation,
			"subject":  map[string]string{"type": subjectType, "id": subjectID},
		}},
	}
	return c.post(c.tenantPath("relationships/delete"), request, nil)
}

// Lookup APIs are intentionally unavailable until a schema-version-aware
// request contract is provided. Returning local/cache data would misrepresent
// authorization state.
func (c *Client) LookupSubjects(entityType, entityID, permission, subjectType string) ([]string, error) {
	return nil, errors.New("Permify subject lookup is not configured for this gateway")
}

func (c *Client) LookupEntities(entityType, permission, subjectType, subjectID string) ([]string, error) {
	return nil, errors.New("Permify entity lookup is not configured for this gateway")
}

func (c *Client) CheckTradingPermission(userID string, commoditySymbol string, action string) (bool, error) {
	return c.Check("commodity", commoditySymbol, action, "user", userID)
}

func (c *Client) CheckPortfolioAccess(userID string, portfolioID string) (bool, error) {
	return c.Check("portfolio", portfolioID, "view", "user", userID)
}

func (c *Client) tenantPath(operation string) string {
	return "/v1/tenants/" + url.PathEscape(c.tenantID) + "/" + operation
}

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

func (c *Client) IsFallback() bool { return false }

func (c *Client) Close() {
	c.mu.Lock()
	c.connected = false
	c.mu.Unlock()
}
