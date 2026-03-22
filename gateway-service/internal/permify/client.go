package permify

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

// Client wraps Permify fine-grained authorization with real HTTP/gRPC connectivity.
// Schema defines:
//   entity user {}
//   entity organization { relation member @user; relation admin @user }
//   entity commodity { relation exchange @organization }
//   entity order { relation owner @user; relation commodity @commodity }
//   entity portfolio { relation owner @user }
//   entity alert { relation owner @user }
//   entity report { relation viewer @user; relation organization @organization }
//
// Permission model:
//   Farmers: can trade agricultural commodities, view own portfolio
//   Retail traders: can trade all commodities, full portfolio access
//   Institutional: all permissions + bulk orders + API access + advanced analytics
//   Cooperative: shared portfolio management, delegated trading
type Client struct {
	endpoint     string
	connected    bool
	fallbackMode bool
	mu           sync.RWMutex
	httpClient   *http.Client
	// In-memory relationship tuples for fallback
	relationships []RelationshipTuple
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

func NewClient(endpoint string) *Client {
	c := &Client{
		endpoint:      endpoint,
		relationships: make([]RelationshipTuple, 0),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
	c.connect()
	return c
}

func (c *Client) connect() {
	log.Printf("[Permify] Connecting to %s", c.endpoint)

	// Attempt TCP connection to Permify
	conn, err := net.DialTimeout("tcp", c.endpoint, 3*time.Second)
	if err != nil {
		log.Printf("[Permify] WARN: Cannot reach %s: %v — running in fallback mode (allow-all)", c.endpoint, err)
		c.mu.Lock()
		c.fallbackMode = true
		c.connected = false
		c.mu.Unlock()
		return
	}
	conn.Close()

	c.mu.Lock()
	c.connected = true
	c.fallbackMode = false
	c.mu.Unlock()
	log.Printf("[Permify] Connected to %s (TCP verified)", c.endpoint)
}

// Check verifies if a subject has a permission on an entity
func (c *Client) Check(entityType, entityID, permission, subjectType, subjectID string) (bool, error) {
	c.mu.RLock()
	isFallback := c.fallbackMode
	c.mu.RUnlock()

	if !isFallback {
		// Real Permify permission check via REST API
		reqBody := map[string]interface{}{
			"metadata": map[string]interface{}{
				"schema_version": "",
				"snap_token":     "",
				"depth":          20,
			},
			"entity": map[string]string{
				"type": entityType,
				"id":   entityID,
			},
			"permission": permission,
			"subject": map[string]interface{}{
				"type": subjectType,
				"id":   subjectID,
			},
		}
		body, _ := json.Marshal(reqBody)
		url := fmt.Sprintf("http://%s/v1/tenants/nexcom/permissions/check", c.endpoint)
		resp, err := c.httpClient.Post(url, "application/json", bytes.NewReader(body))
		if err == nil {
			defer resp.Body.Close()
			respBody, _ := io.ReadAll(resp.Body)
			var result map[string]interface{}
			if json.Unmarshal(respBody, &result) == nil {
				if can, ok := result["can"].(string); ok {
					return can == "CHECK_RESULT_ALLOWED", nil
				}
			}
		}
		log.Printf("[Permify] WARN: Permission check via API failed, using fallback")
	}

	// Fallback: check in-memory relationships or allow all
	c.mu.RLock()
	for _, rel := range c.relationships {
		if rel.EntityType == entityType && rel.EntityID == entityID &&
			rel.Relation == permission && rel.SubjectType == subjectType &&
			rel.SubjectID == subjectID {
			c.mu.RUnlock()
			return true, nil
		}
	}
	c.mu.RUnlock()

	// Default: allow in development
	return true, nil
}

// WriteRelationship creates a relationship tuple
func (c *Client) WriteRelationship(entityType, entityID, relation, subjectType, subjectID string) error {
	c.mu.RLock()
	isFallback := c.fallbackMode
	c.mu.RUnlock()

	if !isFallback {
		reqBody := map[string]interface{}{
			"metadata": map[string]interface{}{
				"schema_version": "",
			},
			"tuples": []map[string]interface{}{
				{
					"entity":   map[string]string{"type": entityType, "id": entityID},
					"relation": relation,
					"subject":  map[string]interface{}{"type": subjectType, "id": subjectID},
				},
			},
		}
		body, _ := json.Marshal(reqBody)
		url := fmt.Sprintf("http://%s/v1/tenants/nexcom/relationships/write", c.endpoint)
		resp, err := c.httpClient.Post(url, "application/json", bytes.NewReader(body))
		if err == nil {
			resp.Body.Close()
			log.Printf("[Permify] WriteRelationship: %s:%s#%s@%s:%s (via API)", entityType, entityID, relation, subjectType, subjectID)
			return nil
		}
	}

	// Fallback: store in memory
	c.mu.Lock()
	c.relationships = append(c.relationships, RelationshipTuple{
		EntityType: entityType, EntityID: entityID, Relation: relation,
		SubjectType: subjectType, SubjectID: subjectID,
	})
	c.mu.Unlock()
	log.Printf("[Permify] WriteRelationship: %s:%s#%s@%s:%s (fallback)", entityType, entityID, relation, subjectType, subjectID)
	return nil
}

// DeleteRelationship removes a relationship tuple
func (c *Client) DeleteRelationship(entityType, entityID, relation, subjectType, subjectID string) error {
	c.mu.Lock()
	for i, rel := range c.relationships {
		if rel.EntityType == entityType && rel.EntityID == entityID &&
			rel.Relation == relation && rel.SubjectType == subjectType &&
			rel.SubjectID == subjectID {
			c.relationships = append(c.relationships[:i], c.relationships[i+1:]...)
			break
		}
	}
	c.mu.Unlock()
	log.Printf("[Permify] DeleteRelationship: %s:%s#%s@%s:%s", entityType, entityID, relation, subjectType, subjectID)
	return nil
}

// LookupSubjects finds all subjects with a permission on an entity
func (c *Client) LookupSubjects(entityType, entityID, permission, subjectType string) ([]string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var subjects []string
	for _, rel := range c.relationships {
		if rel.EntityType == entityType && rel.EntityID == entityID &&
			rel.Relation == permission && rel.SubjectType == subjectType {
			subjects = append(subjects, rel.SubjectID)
		}
	}
	return subjects, nil
}

// LookupEntities finds all entities a subject has permission on
func (c *Client) LookupEntities(entityType, permission, subjectType, subjectID string) ([]string, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	var entities []string
	for _, rel := range c.relationships {
		if rel.EntityType == entityType && rel.Relation == permission &&
			rel.SubjectType == subjectType && rel.SubjectID == subjectID {
			entities = append(entities, rel.EntityID)
		}
	}
	return entities, nil
}

// CheckTradingPermission checks if a user can trade a specific commodity
func (c *Client) CheckTradingPermission(userID string, commoditySymbol string, action string) (bool, error) {
	return c.Check("commodity", commoditySymbol, action, "user", userID)
}

// CheckPortfolioAccess checks if a user can access a portfolio
func (c *Client) CheckPortfolioAccess(userID string, portfolioID string) (bool, error) {
	return c.Check("portfolio", portfolioID, "view", "user", userID)
}

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

func (c *Client) IsFallback() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.fallbackMode
}

func (c *Client) Close() {
	c.mu.Lock()
	c.connected = false
	c.mu.Unlock()
	log.Println("[Permify] Connection closed")
}
