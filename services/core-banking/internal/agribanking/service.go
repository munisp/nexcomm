// Package agribanking implements the Agricultural Banking Module for NEXCOM Exchange.
// It orchestrates the full agri-finance lifecycle:
//   1. Farmer onboarding → KYC → account creation in CBS
//   2. Crop cycle registration → input loan disbursement
//   3. Harvest → warehouse receipt generation → WR-backed financing
//   4. Market sale → settlement → loan repayment
//   5. Insurance policy creation and claims processing
//
// This service acts as the domain orchestrator, calling the CBS adapter
// for banking operations and publishing events to Kafka for downstream
// consumers (risk, analytics, notifications).
package agribanking

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/IBM/sarama"
	"github.com/google/uuid"
	"github.com/nexcom/core-banking/internal/models"
	"github.com/shopspring/decimal"
	"go.uber.org/zap"
)

// Service orchestrates agricultural banking operations.
type Service struct {
	cbs   models.CBSAdapter
	kafka sarama.SyncProducer
	log   *zap.Logger
}

// New creates a new Agribanking service.
func New(cbs models.CBSAdapter, kafka sarama.SyncProducer, log *zap.Logger) *Service {
	return &Service{cbs: cbs, kafka: kafka, log: log.Named("agribanking")}
}

// ─── Farmer Onboarding ────────────────────────────────────────────────────────

// OnboardFarmerRequest contains the data needed to onboard a new farmer.
type OnboardFarmerRequest struct {
	NexcomUserID string
	FullName     string
	PhoneNumber  string
	NIN          string // National Identification Number
	BVN          string // Bank Verification Number (Nigeria)
	Currency     string // default "NGN"
}

// OnboardFarmerResult contains the accounts created for the farmer.
type OnboardFarmerResult struct {
	EscrowAccount *models.BankAccount
}

// OnboardFarmer creates the necessary bank accounts for a newly KYC-verified farmer.
// Triggered after the KYC service marks the farmer as APPROVED.
func (s *Service) OnboardFarmer(ctx context.Context, req OnboardFarmerRequest) (*OnboardFarmerResult, error) {
	s.log.Info("onboarding farmer", zap.String("userId", req.NexcomUserID))

	currency := req.Currency
	if currency == "" {
		currency = "NGN"
	}

	escrow, err := s.cbs.CreateEscrowAccount(ctx, req.NexcomUserID, currency)
	if err != nil {
		return nil, fmt.Errorf("create escrow account: %w", err)
	}

	s.publishEvent(ctx, "agri.farmer.onboarded", map[string]any{
		"userId":        req.NexcomUserID,
		"escrowAccount": escrow.ExternalRef,
		"currency":      currency,
		"timestamp":     time.Now().UTC(),
	})

	return &OnboardFarmerResult{EscrowAccount: escrow}, nil
}

// ─── Crop Cycle Management ────────────────────────────────────────────────────

// RegisterCropCycle registers a new planting cycle for a farmer.
func (s *Service) RegisterCropCycle(ctx context.Context, cycle *models.CropCycle) (*models.CropCycle, error) {
	if cycle.ID == "" {
		cycle.ID = uuid.New().String()
	}
	cycle.Status = "ACTIVE"

	s.publishEvent(ctx, "agri.crop_cycle.registered", map[string]any{
		"cycleId":    cycle.ID,
		"farmerId":   cycle.FarmerID,
		"crop":       cycle.Crop,
		"season":     cycle.Season,
		"farmSizeHa": cycle.FarmSizeHa.String(),
		"timestamp":  time.Now().UTC(),
	})

	s.log.Info("crop cycle registered",
		zap.String("cycleId", cycle.ID),
		zap.String("farmerId", cycle.FarmerID),
		zap.String("crop", cycle.Crop))

	return cycle, nil
}

// ─── Input Loan Disbursement ──────────────────────────────────────────────────

// InputLoanRequest contains the parameters for an agricultural input loan.
type InputLoanRequest struct {
	FarmerID         string
	CropCycleID      string
	ProductCode      string
	Amount           decimal.Decimal
	InterestRate     decimal.Decimal
	TenorMonths      int
	DisbursementAcct string
	RepaymentAcct    string
	CollateralType   string
	CollateralRef    string
	InputItems       []InputItem
}

// InputItem describes a specific agricultural input being financed.
type InputItem struct {
	Name     string          `json:"name"`
	Quantity decimal.Decimal `json:"quantity"`
	Unit     string          `json:"unit"`
	UnitCost decimal.Decimal `json:"unitCost"`
	Supplier string          `json:"supplier,omitempty"`
}

// DisburseInputLoan creates and disburses an agricultural input loan via the CBS.
func (s *Service) DisburseInputLoan(ctx context.Context, req InputLoanRequest) (*models.AgriLoan, error) {
	s.log.Info("disbursing input loan",
		zap.String("farmerId", req.FarmerID),
		zap.String("amount", req.Amount.String()))

	loan := &models.AgriLoan{
		ID:               uuid.New().String(),
		BorrowerID:       req.FarmerID,
		FarmerID:         &req.FarmerID,
		ProductCode:      req.ProductCode,
		Principal:        req.Amount,
		InterestRate:     req.InterestRate,
		Tenor:            req.TenorMonths,
		DisbursementAcct: req.DisbursementAcct,
		RepaymentAcct:    req.RepaymentAcct,
		CollateralType:   req.CollateralType,
		CollateralRef:    req.CollateralRef,
	}

	disbursed, err := s.cbs.DisburseInputLoan(ctx, loan)
	if err != nil {
		return nil, fmt.Errorf("disburse input loan: %w", err)
	}

	s.publishEvent(ctx, "agri.loan.disbursed", map[string]any{
		"loanId":      disbursed.ID,
		"farmerId":    req.FarmerID,
		"cropCycleId": req.CropCycleID,
		"amount":      req.Amount.String(),
		"currency":    "NGN",
		"collateral":  req.CollateralType,
		"timestamp":   time.Now().UTC(),
	})

	return disbursed, nil
}

// ─── Warehouse Receipt Financing ──────────────────────────────────────────────

// WRFinancingRequest contains the parameters for WR-backed financing.
type WRFinancingRequest struct {
	FarmerID         string
	WRID             string
	CommoditySymbol  string
	QuantityTons     decimal.Decimal
	MarketValueNGN   decimal.Decimal
	LTVRatio         decimal.Decimal // e.g. 0.70 for 70%
	DisbursementAcct string
	RepaymentAcct    string
	TenorMonths      int
}

// WRFinancingResult contains the created loan details.
type WRFinancingResult struct {
	Loan       *models.AgriLoan
	LoanAmount decimal.Decimal
}

// IssueWRFinancing creates a warehouse-receipt-backed loan.
func (s *Service) IssueWRFinancing(ctx context.Context, req WRFinancingRequest) (*WRFinancingResult, error) {
	loanAmount := req.MarketValueNGN.Mul(req.LTVRatio)

	s.log.Info("issuing WR-backed financing",
		zap.String("wrId", req.WRID),
		zap.String("loanAmount", loanAmount.String()))

	loanReq := InputLoanRequest{
		FarmerID:         req.FarmerID,
		ProductCode:      "AGRI_WR_FINANCE",
		Amount:           loanAmount,
		InterestRate:     decimal.NewFromFloat(12.0),
		TenorMonths:      req.TenorMonths,
		DisbursementAcct: req.DisbursementAcct,
		RepaymentAcct:    req.RepaymentAcct,
		CollateralType:   "WAREHOUSE_RECEIPT",
		CollateralRef:    req.WRID,
	}

	loan, err := s.DisburseInputLoan(ctx, loanReq)
	if err != nil {
		return nil, err
	}

	s.publishEvent(ctx, "agri.wr_financing.issued", map[string]any{
		"loanId":       loan.ID,
		"wrId":         req.WRID,
		"farmerId":     req.FarmerID,
		"commodity":    req.CommoditySymbol,
		"quantityTons": req.QuantityTons.String(),
		"marketValue":  req.MarketValueNGN.String(),
		"loanAmount":   loanAmount.String(),
		"ltvRatio":     req.LTVRatio.String(),
		"timestamp":    time.Now().UTC(),
	})

	return &WRFinancingResult{Loan: loan, LoanAmount: loanAmount}, nil
}

// ─── Trade Settlement → Loan Repayment ───────────────────────────────────────

// SettlementRepaymentRequest links a NEXCOM trade settlement to a loan repayment.
type SettlementRepaymentRequest struct {
	FarmerID      string
	LoanRef       string
	SettlementID  int64
	GrossProceeds decimal.Decimal
	LoanBalance   decimal.Decimal
	FeeAmount     decimal.Decimal
	NetToFarmer   decimal.Decimal
	Currency      string
}

// ProcessSettlementRepayment applies trade sale proceeds to outstanding loans.
func (s *Service) ProcessSettlementRepayment(ctx context.Context, req SettlementRepaymentRequest) error {
	s.log.Info("processing settlement repayment",
		zap.String("loanRef", req.LoanRef),
		zap.String("repayment", req.LoanBalance.String()))

	updatedLoan, err := s.cbs.RecordRepayment(ctx, req.LoanRef, req.LoanBalance)
	if err != nil {
		return fmt.Errorf("record repayment: %w", err)
	}

	s.publishEvent(ctx, "agri.loan.repayment_processed", map[string]any{
		"loanRef":          req.LoanRef,
		"farmerId":         req.FarmerID,
		"settlementId":     req.SettlementID,
		"repaymentAmount":  req.LoanBalance.String(),
		"remainingBalance": updatedLoan.OutstandingBalance.String(),
		"loanStatus":       updatedLoan.Status,
		"netToFarmer":      req.NetToFarmer.String(),
		"timestamp":        time.Now().UTC(),
	})

	return nil
}

// ─── Insurance ───────────────────────────────────────────────────────────────

// CreateInsurancePolicy links a crop cycle to an area-yield-index insurance product.
func (s *Service) CreateInsurancePolicy(ctx context.Context, policy *models.AgriInsurancePolicy) (*models.AgriInsurancePolicy, error) {
	if policy.ID == "" {
		policy.ID = uuid.New().String()
	}
	policy.Status = "ACTIVE"

	instr := &models.PaymentInstruction{
		ID:             uuid.New().String(),
		EndToEndID:     fmt.Sprintf("INS-PREM-%s", policy.ID),
		DebtorAcct:     policy.FarmerID,
		CreditorAcct:   "NEXCOM_INSURANCE_PREMIUM_POOL",
		CreditorName:   "NEXCOM Insurance Premium Pool",
		Amount:         policy.Premium,
		Currency:       "NGN",
		ValueDate:      time.Now(),
		Purpose:        "INSU",
		RemittanceInfo: fmt.Sprintf("Insurance premium for policy %s", policy.ID),
		NexcomRef:      policy.ID,
		Channel:        "INTERNAL",
	}

	if _, err := s.cbs.InitiatePayment(ctx, instr); err != nil {
		return nil, fmt.Errorf("debit insurance premium: %w", err)
	}

	s.publishEvent(ctx, "agri.insurance.policy_created", map[string]any{
		"policyId":    policy.ID,
		"farmerId":    policy.FarmerID,
		"cropCycleId": policy.CropCycleID,
		"productCode": policy.ProductCode,
		"sumInsured":  policy.SumInsured.String(),
		"premium":     policy.Premium.String(),
		"startDate":   policy.StartDate,
		"endDate":     policy.EndDate,
		"timestamp":   time.Now().UTC(),
	})

	return policy, nil
}

// ProcessInsuranceClaim processes a crop insurance claim.
func (s *Service) ProcessInsuranceClaim(ctx context.Context, policy *models.AgriInsurancePolicy, claimAmount decimal.Decimal) error {
	now := time.Now()
	policy.ClaimAmount = &claimAmount
	policy.ClaimDate = &now
	policy.Status = "CLAIMED"

	instr := &models.PaymentInstruction{
		ID:             uuid.New().String(),
		EndToEndID:     fmt.Sprintf("INS-CLAIM-%s", policy.ID),
		DebtorAcct:     "NEXCOM_INSURANCE_CLAIMS_POOL",
		DebtorName:     "NEXCOM Insurance Claims Pool",
		CreditorAcct:   policy.FarmerID,
		CreditorName:   "Farmer",
		Amount:         claimAmount,
		Currency:       "NGN",
		ValueDate:      now,
		Purpose:        "INSU",
		RemittanceInfo: fmt.Sprintf("Insurance claim payout for policy %s", policy.ID),
		NexcomRef:      policy.ID,
		Channel:        "INTERNAL",
	}

	if _, err := s.cbs.InitiatePayment(ctx, instr); err != nil {
		return fmt.Errorf("credit insurance claim: %w", err)
	}

	s.publishEvent(ctx, "agri.insurance.claim_processed", map[string]any{
		"policyId":    policy.ID,
		"farmerId":    policy.FarmerID,
		"claimAmount": claimAmount.String(),
		"timestamp":   now.UTC(),
	})

	return nil
}

// ─── Kafka event publishing ───────────────────────────────────────────────────

func (s *Service) publishEvent(ctx context.Context, topic string, payload map[string]any) {
	if s.kafka == nil {
		return
	}
	b, err := json.Marshal(payload)
	if err != nil {
		s.log.Warn("failed to marshal event", zap.String("topic", topic), zap.Error(err))
		return
	}
	msg := &sarama.ProducerMessage{
		Topic: topic,
		Value: sarama.ByteEncoder(b),
	}
	if _, _, err := s.kafka.SendMessage(msg); err != nil {
		s.log.Warn("failed to publish event", zap.String("topic", topic), zap.Error(err))
	}
}
