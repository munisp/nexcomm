// Package kyc implements Temporal workflows for KYC/AML onboarding.
// Orchestrates: document upload → OCR/validation → identity verification →
// sanctions screening → risk assessment → approval/rejection.
package kyc

import (
	"time"

	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// KYCInput represents the input to start a KYC workflow
type KYCInput struct {
	UserID    string   `json:"user_id"`
	Level     string   `json:"level"` // "basic", "enhanced", "full"
	Documents []string `json:"document_urls"`
	UserTier  string   `json:"user_tier"` // "farmer", "retail", "institutional"
}

// KYCResult represents the KYC workflow outcome
type KYCResult struct {
	UserID      string    `json:"user_id"`
	Status      string    `json:"status"` // "approved", "rejected", "manual_review"
	Level       string    `json:"level"`
	RiskScore   int       `json:"risk_score"`
	CompletedAt time.Time `json:"completed_at"`
	Notes       string    `json:"notes,omitempty"`
}

// KYCOnboardingWorkflow orchestrates the full KYC process
func KYCOnboardingWorkflow(ctx workflow.Context, input KYCInput) (*KYCResult, error) {
	logger := workflow.GetLogger(ctx)
	logger.Info("Starting KYC workflow", "user_id", input.UserID, "level", input.Level)

	activityOpts := workflow.ActivityOptions{
		StartToCloseTimeout: 5 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    5 * time.Second,
			BackoffCoefficient: 2.0,
			MaximumInterval:    2 * time.Minute,
			MaximumAttempts:    3,
		},
	}
	ctx = workflow.WithActivityOptions(ctx, activityOpts)

	// Step 1: Validate uploaded documents (OCR, format check)
	var docResult DocumentValidationResult
	err := workflow.ExecuteActivity(ctx, ValidateDocumentsActivity, input).Get(ctx, &docResult)
	if err != nil || !docResult.Valid {
		return &KYCResult{
			UserID: input.UserID, Status: "rejected", Level: input.Level,
			CompletedAt: workflow.Now(ctx), Notes: "Document validation failed",
		}, nil
	}

	// Step 2: Identity verification (facial match, data extraction)
	var identityResult IdentityVerificationResult
	err = workflow.ExecuteActivity(ctx, VerifyIdentityActivity, input).Get(ctx, &identityResult)
	if err != nil {
		return nil, err
	}

	// Step 3: Sanctions and PEP screening
	var sanctionsResult SanctionsScreeningResult
	err = workflow.ExecuteActivity(ctx, ScreenSanctionsActivity, SanctionsInput{
		UserID:    input.UserID,
		FullName:  identityResult.FullName,
		DOB:       identityResult.DateOfBirth,
		Nationality: identityResult.Nationality,
	}).Get(ctx, &sanctionsResult)
	if err != nil {
		return nil, err
	}

	if sanctionsResult.Hit {
		return &KYCResult{
			UserID: input.UserID, Status: "rejected", Level: input.Level,
			CompletedAt: workflow.Now(ctx), Notes: "Sanctions screening hit",
		}, nil
	}

	// Step 4: Risk assessment
	var riskResult KYCRiskResult
	err = workflow.ExecuteActivity(ctx, AssessKYCRiskActivity, input).Get(ctx, &riskResult)
	if err != nil {
		return nil, err
	}

	// Step 5: Auto-approve or send to manual review
	status := "approved"
	if riskResult.Score > 70 || input.Level == "full" {
		status = "manual_review"
		// For manual review: wait for human signal (up to 72 hours)
		if status == "manual_review" {
			var reviewResult ManualReviewResult
			reviewCh := workflow.GetSignalChannel(ctx, "manual_review_complete")
			timerCtx, cancelTimer := workflow.WithCancel(ctx)
			timer := workflow.NewTimer(timerCtx, 72*time.Hour)

			selector := workflow.NewSelector(ctx)
			selector.AddReceive(reviewCh, func(c workflow.ReceiveChannel, more bool) {
				c.Receive(ctx, &reviewResult)
				cancelTimer()
			})
			selector.AddFuture(timer, func(f workflow.Future) {
				reviewResult = ManualReviewResult{Approved: false, Notes: "Review timeout"}
			})
			selector.Select(ctx)

			if reviewResult.Approved {
				status = "approved"
			} else {
				status = "rejected"
			}
		}
	}

	// Step 6: Update user KYC level in Keycloak
	if status == "approved" {
		_ = workflow.ExecuteActivity(ctx, UpdateKYCLevelActivity, UpdateKYCInput{
			UserID: input.UserID,
			Level:  input.Level,
		}).Get(ctx, nil)
	}

	// Step 7: Send notification
	_ = workflow.ExecuteActivity(ctx, SendKYCNotificationActivity, KYCNotificationInput{
		UserID: input.UserID,
		Status: status,
		Level:  input.Level,
	}).Get(ctx, nil)

	return &KYCResult{
		UserID:      input.UserID,
		Status:      status,
		Level:       input.Level,
		RiskScore:   riskResult.Score,
		CompletedAt: workflow.Now(ctx),
	}, nil
}

// --- Activity Types ---

type DocumentValidationResult struct {
	Valid    bool     `json:"valid"`
	Details []string `json:"details"`
}

type IdentityVerificationResult struct {
	Verified    bool   `json:"verified"`
	FullName    string `json:"full_name"`
	DateOfBirth string `json:"date_of_birth"`
	Nationality string `json:"nationality"`
	IDNumber    string `json:"id_number"`
}

type SanctionsInput struct {
	UserID      string `json:"user_id"`
	FullName    string `json:"full_name"`
	DOB         string `json:"dob"`
	Nationality string `json:"nationality"`
}

type SanctionsScreeningResult struct {
	Hit     bool   `json:"hit"`
	Details string `json:"details,omitempty"`
}

type KYCRiskResult struct {
	Score  int    `json:"score"`
	Reason string `json:"reason,omitempty"`
}

type ManualReviewResult struct {
	Approved bool   `json:"approved"`
	Notes    string `json:"notes"`
}

type UpdateKYCInput struct {
	UserID string `json:"user_id"`
	Level  string `json:"level"`
}

type KYCNotificationInput struct {
	UserID string `json:"user_id"`
	Status string `json:"status"`
	Level  string `json:"level"`
}
