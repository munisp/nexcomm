package keycloak

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

var (
	// ErrUnavailable is returned when Keycloak cannot be contacted. Callers must
	// surface this as a dependency outage rather than manufacture an identity.
	ErrUnavailable = errors.New("keycloak unavailable")
	// ErrUnauthorized is returned only after Keycloak rejects a credential/token.
	ErrUnauthorized = errors.New("keycloak rejected credentials or token")
)

// Client wraps Keycloak OIDC and administration operations. Every identity and
// credential response is accepted only when it is returned by Keycloak.
type Client struct {
	url               string
	realm             string
	clientID          string
	clientSecret      string
	adminClientID     string
	adminClientSecret string
	connected         bool
	mu                sync.RWMutex
	httpClient        *http.Client
}

type TokenClaims struct {
	Sub           string   `json:"sub"`
	Email         string   `json:"email"`
	Name          string   `json:"name"`
	PreferredUser string   `json:"preferred_username"`
	EmailVerified bool     `json:"email_verified"`
	RealmRoles    []string `json:"realm_roles"`
	AccountTier   string   `json:"account_tier"`
	Exp           int64    `json:"exp"`
	Iat           int64    `json:"iat"`
}

type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
}

type keycloakUser struct {
	ID              string   `json:"id"`
	Username        string   `json:"username"`
	Email           string   `json:"email"`
	RequiredActions []string `json:"requiredActions"`
}

func NewClient(urlStr, realm, clientID string) *Client {
	c := &Client{
		url:               strings.TrimRight(urlStr, "/"),
		realm:             realm,
		clientID:          clientID,
		clientSecret:      os.Getenv("KEYCLOAK_CLIENT_SECRET"),
		adminClientID:     os.Getenv("KEYCLOAK_ADMIN_CLIENT_ID"),
		adminClientSecret: os.Getenv("KEYCLOAK_ADMIN_CLIENT_SECRET"),
		httpClient:        &http.Client{Timeout: 5 * time.Second},
	}
	_ = c.checkConnection()
	return c
}

func (c *Client) realmURL(suffix string) string {
	return fmt.Sprintf("%s/realms/%s%s", c.url, url.PathEscape(c.realm), suffix)
}

func (c *Client) adminURL(suffix string) string {
	return fmt.Sprintf("%s/admin/realms/%s%s", c.url, url.PathEscape(c.realm), suffix)
}

func (c *Client) checkConnection() error {
	resp, err := c.httpClient.Get(c.realmURL("/.well-known/openid-configuration"))
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: OIDC discovery request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: OIDC discovery returned HTTP %d", ErrUnavailable, resp.StatusCode)
	}
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
	if err := c.checkConnection(); err != nil {
		return err
	}
	return nil
}

func (c *Client) tokenEndpoint(values url.Values) (*TokenResponse, error) {
	if err := c.ensureConnected(); err != nil {
		return nil, err
	}
	values.Set("client_id", c.clientID)
	if c.clientSecret != "" {
		values.Set("client_secret", c.clientSecret)
	}
	resp, err := c.httpClient.PostForm(c.realmURL("/protocol/openid-connect/token"), values)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return nil, fmt.Errorf("%w: token request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if readErr != nil {
		return nil, fmt.Errorf("read Keycloak token response: %w", readErr)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		if resp.StatusCode >= http.StatusBadRequest && resp.StatusCode < http.StatusInternalServerError {
			return nil, fmt.Errorf("%w: HTTP %d", ErrUnauthorized, resp.StatusCode)
		}
		return nil, fmt.Errorf("%w: token endpoint returned HTTP %d", ErrUnavailable, resp.StatusCode)
	}
	var tokens TokenResponse
	if err := json.Unmarshal(body, &tokens); err != nil {
		return nil, fmt.Errorf("decode Keycloak token response: %w", err)
	}
	if tokens.AccessToken == "" || tokens.TokenType == "" {
		return nil, fmt.Errorf("%w: token response omitted required fields", ErrUnavailable)
	}
	return &tokens, nil
}

// ValidateToken only trusts Keycloak token introspection. It deliberately does
// not parse or accept unsigned JWT payloads when the identity provider is down.
func (c *Client) ValidateToken(token string) (*TokenClaims, error) {
	if strings.TrimSpace(token) == "" {
		return nil, fmt.Errorf("%w: empty token", ErrUnauthorized)
	}
	if err := c.ensureConnected(); err != nil {
		return nil, err
	}
	data := url.Values{}
	data.Set("token", token)
	data.Set("client_id", c.clientID)
	if c.clientSecret != "" {
		data.Set("client_secret", c.clientSecret)
	}
	resp, err := c.httpClient.PostForm(c.realmURL("/protocol/openid-connect/token/introspect"), data)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return nil, fmt.Errorf("%w: introspection request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%w: introspection returned HTTP %d", ErrUnavailable, resp.StatusCode)
	}
	var result map[string]interface{}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode Keycloak introspection response: %w", err)
	}
	active, ok := result["active"].(bool)
	if !ok || !active {
		return nil, ErrUnauthorized
	}
	return extractClaimsFromIntrospection(result), nil
}

func extractClaimsFromIntrospection(result map[string]interface{}) *TokenClaims {
	claims := &TokenClaims{}
	if value, ok := result["sub"].(string); ok {
		claims.Sub = value
	}
	if value, ok := result["email"].(string); ok {
		claims.Email = value
	}
	if value, ok := result["name"].(string); ok {
		claims.Name = value
	}
	if value, ok := result["preferred_username"].(string); ok {
		claims.PreferredUser = value
	}
	if value, ok := result["email_verified"].(bool); ok {
		claims.EmailVerified = value
	}
	if value, ok := result["exp"].(float64); ok {
		claims.Exp = int64(value)
	}
	if value, ok := result["iat"].(float64); ok {
		claims.Iat = int64(value)
	}
	if roles, ok := result["realm_access"].(map[string]interface{}); ok {
		if rawRoles, ok := roles["roles"].([]interface{}); ok {
			for _, role := range rawRoles {
				if roleName, ok := role.(string); ok {
					claims.RealmRoles = append(claims.RealmRoles, roleName)
				}
			}
		}
	}
	if tier, ok := result["account_tier"].(string); ok {
		claims.AccountTier = tier
	}
	return claims
}

// ExchangeCode completes the OIDC authorization-code + PKCE exchange.
func (c *Client) ExchangeCode(code, redirectURI, codeVerifier string) (*TokenResponse, error) {
	if strings.TrimSpace(code) == "" || strings.TrimSpace(redirectURI) == "" {
		return nil, fmt.Errorf("%w: authorization code and redirect URI are required", ErrUnauthorized)
	}
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", redirectURI)
	if codeVerifier != "" {
		data.Set("code_verifier", codeVerifier)
	}
	return c.tokenEndpoint(data)
}

// ExchangePassword is used only by the legacy gateway login endpoint. New web
// clients should use authorization-code + PKCE; this method never fakes a token.
func (c *Client) ExchangePassword(username, password string) (*TokenResponse, error) {
	if strings.TrimSpace(username) == "" || password == "" {
		return nil, fmt.Errorf("%w: username and password are required", ErrUnauthorized)
	}
	data := url.Values{}
	data.Set("grant_type", "password")
	data.Set("username", username)
	data.Set("password", password)
	return c.tokenEndpoint(data)
}

func (c *Client) RefreshTokens(refreshToken string) (*TokenResponse, error) {
	if strings.TrimSpace(refreshToken) == "" {
		return nil, fmt.Errorf("%w: refresh token is required", ErrUnauthorized)
	}
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)
	return c.tokenEndpoint(data)
}

func (c *Client) RevokeToken(refreshToken string) error {
	if strings.TrimSpace(refreshToken) == "" {
		return fmt.Errorf("%w: refresh token is required", ErrUnauthorized)
	}
	if err := c.ensureConnected(); err != nil {
		return err
	}
	data := url.Values{}
	data.Set("client_id", c.clientID)
	data.Set("refresh_token", refreshToken)
	if c.clientSecret != "" {
		data.Set("client_secret", c.clientSecret)
	}
	resp, err := c.httpClient.PostForm(c.realmURL("/protocol/openid-connect/logout"), data)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: logout request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("Keycloak logout returned HTTP %d", resp.StatusCode)
	}
	return nil
}

func (c *Client) adminToken() (string, error) {
	clientID, secret := c.adminClientID, c.adminClientSecret
	if clientID == "" || secret == "" {
		return "", errors.New("Keycloak admin client credentials are not configured")
	}
	if err := c.ensureConnected(); err != nil {
		return "", err
	}
	data := url.Values{}
	data.Set("grant_type", "client_credentials")
	data.Set("client_id", clientID)
	data.Set("client_secret", secret)
	resp, err := c.httpClient.PostForm(c.realmURL("/protocol/openid-connect/token"), data)
	if err != nil {
		return "", fmt.Errorf("%w: admin-token request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("Keycloak admin-token request returned HTTP %d", resp.StatusCode)
	}
	var tokens TokenResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&tokens); err != nil {
		return "", fmt.Errorf("decode Keycloak admin token: %w", err)
	}
	if tokens.AccessToken == "" {
		return "", errors.New("Keycloak admin-token response omitted access_token")
	}
	return tokens.AccessToken, nil
}

func (c *Client) adminRequest(method, requestPath string, body io.Reader, out interface{}) error {
	token, err := c.adminToken()
	if err != nil {
		return err
	}
	req, err := http.NewRequest(method, c.adminURL(requestPath), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		c.mu.Lock()
		c.connected = false
		c.mu.Unlock()
		return fmt.Errorf("%w: admin request failed: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
		return fmt.Errorf("Keycloak admin API returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}
	if out != nil {
		if err := json.NewDecoder(io.LimitReader(resp.Body, 128*1024)).Decode(out); err != nil && !errors.Is(err, io.EOF) {
			return err
		}
	}
	return nil
}

func (c *Client) getUser(userID string) (*keycloakUser, error) {
	var user keycloakUser
	if err := c.adminRequest(http.MethodGet, "/users/"+url.PathEscape(userID), nil, &user); err != nil {
		return nil, err
	}
	if user.ID == "" {
		return nil, fmt.Errorf("Keycloak returned no user for %s", userID)
	}
	return &user, nil
}

// ChangePassword verifies the user’s current password with Keycloak, then uses
// a configured realm-management service account to set the new credential.
func (c *Client) ChangePassword(userID, currentPassword, newPassword string) error {
	if len(newPassword) < 8 {
		return errors.New("new password must be at least 8 characters")
	}
	user, err := c.getUser(userID)
	if err != nil {
		return err
	}
	username := user.Username
	if username == "" {
		username = user.Email
	}
	if _, err := c.ExchangePassword(username, currentPassword); err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]interface{}{"type": "password", "value": newPassword, "temporary": false})
	if err != nil {
		return err
	}
	return c.adminRequest(http.MethodPut, "/users/"+url.PathEscape(userID)+"/reset-password", strings.NewReader(string(payload)), nil)
}

func (c *Client) GetUserSessions(userID string) ([]map[string]interface{}, error) {
	var sessions []map[string]interface{}
	if err := c.adminRequest(http.MethodGet, "/users/"+url.PathEscape(userID)+"/sessions", nil, &sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func (c *Client) RevokeSession(sessionID string) error {
	if strings.TrimSpace(sessionID) == "" {
		return errors.New("session ID is required")
	}
	return c.adminRequest(http.MethodDelete, "/sessions/"+url.PathEscape(sessionID), nil, nil)
}

// Enable2FA requires the Keycloak account console to collect the TOTP secret.
// It schedules the real Keycloak required action and returns the account-security
// URL; no secret is generated or returned by this service.
func (c *Client) Enable2FA(userID string) (string, error) {
	user, err := c.getUser(userID)
	if err != nil {
		return "", err
	}
	for _, action := range user.RequiredActions {
		if action == "CONFIGURE_TOTP" {
			return c.realmURL("/account/#/security/signingin"), nil
		}
	}
	user.RequiredActions = append(user.RequiredActions, "CONFIGURE_TOTP")
	payload, err := json.Marshal(map[string]interface{}{"requiredActions": user.RequiredActions})
	if err != nil {
		return "", err
	}
	if err := c.adminRequest(http.MethodPut, "/users/"+url.PathEscape(userID), strings.NewReader(string(payload)), nil); err != nil {
		return "", err
	}
	return c.realmURL("/account/#/security/signingin"), nil
}

func (c *Client) IsConnected() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.connected
}

// IsFallback is retained for API compatibility. A false return means no local
// identity fallback exists; callers must inspect IsConnected before proceeding.
func (c *Client) IsFallback() bool { return false }

func (c *Client) GetAuthURL() string  { return c.realmURL("/protocol/openid-connect/auth") }
func (c *Client) GetTokenURL() string { return c.realmURL("/protocol/openid-connect/token") }

// BuildAccountURL safely joins a realm account path without exposing a caller to
// brittle string concatenation in authentication handlers.
func (c *Client) BuildAccountURL(parts ...string) string {
	return c.realmURL("/account/" + path.Join(parts...))
}

func (c *Client) LogConnectivity() {
	if err := c.ensureConnected(); err != nil {
		log.Printf("[Keycloak] %v", err)
		return
	}
	log.Printf("[Keycloak] Connected to %s realm=%s", c.url, c.realm)
}
