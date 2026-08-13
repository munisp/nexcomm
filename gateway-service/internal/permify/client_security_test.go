package permify

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAuthenticatedClientFailsClosedWithoutHTTPSOrToken(t *testing.T) {
	if client := NewAuthenticatedClient("http://permify.internal:3476", "tenant", "token"); client.IsConnected() {
		t.Fatal("authenticated client must reject non-HTTPS endpoints")
	}
	if client := NewAuthenticatedClient("https://permify.internal:3476", "tenant", ""); client.IsConnected() {
		t.Fatal("authenticated client must reject an empty token")
	}
}

func TestAuthenticatedClientUsesTokenAndConfiguredTenant(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Errorf("authorization header = %q", got)
		}
		if got, want := r.URL.EscapedPath(), "/v1/tenants/staging-tenant/permissions/check"; got != want {
			t.Errorf("path = %q, want %q", got, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"can":"CHECK_RESULT_ALLOWED"}`))
	}))
	defer server.Close()

	client := NewAuthenticatedClient(server.URL, "staging-tenant", "test-token")
	client.httpClient = server.Client()
	allowed, err := client.Check("commodity", "nonprod-1", "trade", "user", "smoke-user")
	if err != nil {
		t.Fatalf("Check returned error: %v", err)
	}
	if !allowed {
		t.Fatal("Check returned denied, want allowed")
	}
}
