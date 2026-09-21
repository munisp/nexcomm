package kyc

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"go.temporal.io/sdk/activity"
)

// Activity implementations for KYCOnboardingWorkflow (workflow.go). These run
// on a Temporal worker and call the kyc-service HTTP API. All of them fail
// closed: any transport or non-2xx error aborts the activity (Temporal retries
// per the workflow's retry policy) — no approval is ever fabricated.

var kycServiceURL = getEnv("KYC_SERVICE_URL", "http://kyc-service:8003")

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

var kycHTTPClient = &http.Client{Timeout: 30 * time.Second}

// postForJSON POSTs payload to the kyc-service and decodes the JSON response
// into out. Non-2xx responses are errors (fail closed).
func postForJSON(ctx context.Context, path string, payload any, out any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, kycServiceURL+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := kycHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("kyc-service %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("kyc-service %s returned HTTP %d", path, resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("kyc-service %s decode: %w", path, err)
		}
	}
	return nil
}

// ValidateDocumentsActivity validates uploaded KYC documents (OCR/format).
func ValidateDocumentsActivity(ctx context.Context, input KYCInput) (*DocumentValidationResult, error) {
	activity.GetLogger(ctx).Info("ValidateDocuments", "userId", input.UserID, "docs", len(input.Documents))
	var result DocumentValidationResult
	if err := postForJSON(ctx, "/api/documents/validate", input, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// VerifyIdentityActivity performs identity verification (facial match, data extraction).
func VerifyIdentityActivity(ctx context.Context, input KYCInput) (*IdentityVerificationResult, error) {
	activity.GetLogger(ctx).Info("VerifyIdentity", "userId", input.UserID)
	var result IdentityVerificationResult
	if err := postForJSON(ctx, "/api/identity/verify", input, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ScreenSanctionsActivity runs sanctions/PEP screening.
func ScreenSanctionsActivity(ctx context.Context, input SanctionsInput) (*SanctionsScreeningResult, error) {
	activity.GetLogger(ctx).Info("ScreenSanctions", "userId", input.UserID)
	var result SanctionsScreeningResult
	if err := postForJSON(ctx, "/api/compliance/screen", input, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// AssessKYCRiskActivity computes the applicant risk score.
func AssessKYCRiskActivity(ctx context.Context, input KYCInput) (*KYCRiskResult, error) {
	activity.GetLogger(ctx).Info("AssessKYCRisk", "userId", input.UserID)
	var result KYCRiskResult
	if err := postForJSON(ctx, "/api/risk/assess", input, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

// UpdateKYCLevelActivity persists the approved KYC level (Keycloak attribute).
func UpdateKYCLevelActivity(ctx context.Context, input UpdateKYCInput) error {
	activity.GetLogger(ctx).Info("UpdateKYCLevel", "userId", input.UserID, "level", input.Level)
	return postForJSON(ctx, "/api/kyc/level", input, nil)
}

// SendKYCNotificationActivity notifies the user of the KYC outcome.
func SendKYCNotificationActivity(ctx context.Context, input KYCNotificationInput) error {
	activity.GetLogger(ctx).Info("SendKYCNotification", "userId", input.UserID, "status", input.Status)
	return postForJSON(ctx, "/api/kyc/notify", input, nil)
}
