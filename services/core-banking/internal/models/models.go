// Package models defines the canonical data structures shared across all
// core banking adapter implementations. Every adapter (Temenos, Finacle,
// Mambu, Mojaloop) maps its native types into these structs so that the
// NEXCOM Exchange platform speaks a single internal language.
package models

import (
	"time"

	"github.com/shopspring/decimal"
)

// ─── Account ─────────────────────────────────────────────────────────────────

// AccountType classifies the purpose of a bank account in the agri-finance
// context. BIAN service domain: Account Management.
type AccountType string

const (
	AccountTypeCurrent   AccountType = "CURRENT"
	AccountTypeSavings   AccountType = "SAVINGS"
	AccountTypeLoan      AccountType = "LOAN"
	AccountTypeEscrow    AccountType = "ESCROW"
	AccountTypeCollateral AccountType = "COLLATERAL"
	AccountTypeWarehouse AccountType = "WAREHOUSE_RECEIPT"
	AccountTypeInputLoan AccountType = "INPUT_LOAN"
)

// BankAccount is the canonical representation of a core banking account.
type BankAccount struct {
	ID            string          `json:"id"`
	ExternalRef   string          `json:"externalRef"`   // CBS-native account number
	IBAN          string          `json:"iban,omitempty"`
	Currency      string          `json:"currency"`      // ISO 4217
	Type          AccountType     `json:"type"`
	Balance       decimal.Decimal `json:"balance"`
	AvailBalance  decimal.Decimal `json:"availBalance"`
	HoldAmount    decimal.Decimal `json:"holdAmount"`
	OwnerID       string          `json:"ownerId"`       // NEXCOM user ID
	OwnerName     string          `json:"ownerName"`
	Status        string          `json:"status"`        // ACTIVE | DORMANT | CLOSED
	OpenedAt      time.Time       `json:"openedAt"`
	LastMovement  *time.Time      `json:"lastMovement,omitempty"`
	Metadata      map[string]any  `json:"metadata,omitempty"`
}

// ─── Transaction ─────────────────────────────────────────────────────────────

// TransactionType maps to ISO 20022 CdtDbtInd.
type TransactionType string

const (
	TxCredit TransactionType = "CRDT"
	TxDebit  TransactionType = "DBIT"
)

// BankTransaction is the canonical representation of a posted bank transaction.
type BankTransaction struct {
	ID              string          `json:"id"`
	AccountID       string          `json:"accountId"`
	ExternalRef     string          `json:"externalRef"`
	Type            TransactionType `json:"type"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	BalanceAfter    decimal.Decimal `json:"balanceAfter"`
	ValueDate       time.Time       `json:"valueDate"`
	BookingDate     time.Time       `json:"bookingDate"`
	Narrative       string          `json:"narrative"`
	CounterpartyID  string          `json:"counterpartyId,omitempty"`
	CounterpartyName string         `json:"counterpartyName,omitempty"`
	ISO20022MsgID   string          `json:"iso20022MsgId,omitempty"` // pacs.008 / camt.053
	NexcomOrderID   *int64          `json:"nexcomOrderId,omitempty"` // links to orders table
	NexcomSettlID   *int64          `json:"nexcomSettlId,omitempty"` // links to settlements table
}

// ─── Loan ────────────────────────────────────────────────────────────────────

// LoanStatus follows the BIAN Loan lifecycle states.
type LoanStatus string

const (
	LoanStatusPending    LoanStatus = "PENDING"
	LoanStatusActive     LoanStatus = "ACTIVE"
	LoanStatusArrears    LoanStatus = "ARREARS"
	LoanStatusDefault    LoanStatus = "DEFAULT"
	LoanStatusClosed     LoanStatus = "CLOSED"
	LoanStatusWrittenOff LoanStatus = "WRITTEN_OFF"
)

// AgriLoan represents an agricultural loan product in the core banking system.
// This maps to BIAN service domain: Consumer Loan.
type AgriLoan struct {
	ID                string          `json:"id"`
	ExternalRef       string          `json:"externalRef"`
	BorrowerID        string          `json:"borrowerId"`
	BorrowerName      string          `json:"borrowerName"`
	FarmerID          *string         `json:"farmerId,omitempty"`   // links to field_agents/farmers
	ProductCode       string          `json:"productCode"`          // e.g. "AGRI_INPUT_LOAN_NGN"
	Principal         decimal.Decimal `json:"principal"`
	OutstandingBalance decimal.Decimal `json:"outstandingBalance"`
	InterestRate      decimal.Decimal `json:"interestRate"`         // annual %
	Tenor             int             `json:"tenor"`                // months
	DisbursedAt       *time.Time      `json:"disbursedAt,omitempty"`
	MaturityDate      *time.Time      `json:"maturityDate,omitempty"`
	NextPaymentDate   *time.Time      `json:"nextPaymentDate,omitempty"`
	NextPaymentAmount decimal.Decimal `json:"nextPaymentAmount"`
	Status            LoanStatus      `json:"status"`
	CollateralType    string          `json:"collateralType,omitempty"` // "WAREHOUSE_RECEIPT" | "LAND" | "EQUIPMENT"
	CollateralRef     string          `json:"collateralRef,omitempty"`  // WR ID or land title
	DisbursementAcct  string          `json:"disbursementAcct"`
	RepaymentAcct     string          `json:"repaymentAcct"`
}

// ─── Payment ─────────────────────────────────────────────────────────────────

// PaymentInstruction is the canonical outbound payment request sent to the
// core banking system. Maps to ISO 20022 pacs.008 (FI-to-FI Credit Transfer).
type PaymentInstruction struct {
	ID              string          `json:"id"`
	EndToEndID      string          `json:"endToEndId"`    // ISO 20022 EndToEndId
	DebtorAcct      string          `json:"debtorAcct"`
	DebtorName      string          `json:"debtorName"`
	CreditorAcct    string          `json:"creditorAcct"`
	CreditorName    string          `json:"creditorName"`
	CreditorBIC     string          `json:"creditorBic,omitempty"`
	Amount          decimal.Decimal `json:"amount"`
	Currency        string          `json:"currency"`
	ValueDate       time.Time       `json:"valueDate"`
	Purpose         string          `json:"purpose"`       // ISO 20022 Purp/Cd
	RemittanceInfo  string          `json:"remittanceInfo"`
	NexcomRef       string          `json:"nexcomRef"`     // settlement or order ID
	Channel         string          `json:"channel"`       // "RTGS" | "NIPS" | "MOJALOOP" | "INTERNAL"
}

// PaymentStatus tracks the lifecycle of a payment instruction.
type PaymentStatus struct {
	InstructionID string    `json:"instructionId"`
	Status        string    `json:"status"` // PENDING | ACCEPTED | SETTLED | REJECTED | RETURNED
	CBSRef        string    `json:"cbsRef"` // Core banking system reference
	Timestamp     time.Time `json:"timestamp"`
	Reason        string    `json:"reason,omitempty"`
}

// ─── Agricultural Banking Module ─────────────────────────────────────────────

// CropCycle represents a planting-to-harvest cycle linked to a farmer account.
type CropCycle struct {
	ID            string          `json:"id"`
	FarmerID      string          `json:"farmerId"`
	Season        string          `json:"season"`        // e.g. "2025/2026 Dry Season"
	Crop          string          `json:"crop"`          // e.g. "MAIZE"
	PlantingDate  time.Time       `json:"plantingDate"`
	HarvestDate   *time.Time      `json:"harvestDate,omitempty"`
	FarmSizeHa    decimal.Decimal `json:"farmSizeHa"`
	ExpectedYield decimal.Decimal `json:"expectedYieldTons"`
	ActualYield   *decimal.Decimal `json:"actualYieldTons,omitempty"`
	InputLoanID   *string         `json:"inputLoanId,omitempty"`
	WRIDs         []string        `json:"wrIds,omitempty"` // warehouse receipts generated
	Status        string          `json:"status"`          // PLANNED | ACTIVE | HARVESTED | CLOSED
}

// AgriInsurancePolicy links a crop cycle to an insurance product in the CBS.
type AgriInsurancePolicy struct {
	ID            string          `json:"id"`
	ExternalRef   string          `json:"externalRef"` // insurer policy number
	FarmerID      string          `json:"farmerId"`
	CropCycleID   string          `json:"cropCycleId"`
	ProductCode   string          `json:"productCode"` // e.g. "AREA_YIELD_INDEX"
	SumInsured    decimal.Decimal `json:"sumInsured"`
	Premium       decimal.Decimal `json:"premium"`
	StartDate     time.Time       `json:"startDate"`
	EndDate       time.Time       `json:"endDate"`
	Status        string          `json:"status"` // ACTIVE | LAPSED | CLAIMED | EXPIRED
	ClaimAmount   *decimal.Decimal `json:"claimAmount,omitempty"`
	ClaimDate     *time.Time       `json:"claimDate,omitempty"`
}

// ─── CBS Adapter interface ────────────────────────────────────────────────────

// CBSAdapter is the interface every core banking adapter must implement.
// This follows the Adapter pattern — each CBS (Temenos, Finacle, Mambu) maps
// its native API responses into the canonical models above.
type CBSAdapter interface {
	// Account operations
	GetAccount(ctx interface{}, accountRef string) (*BankAccount, error)
	GetAccountsByOwner(ctx interface{}, ownerID string) ([]*BankAccount, error)
	GetTransactions(ctx interface{}, accountRef string, from, to time.Time) ([]*BankTransaction, error)
	CreateEscrowAccount(ctx interface{}, ownerID, currency string) (*BankAccount, error)

	// Payment operations
	InitiatePayment(ctx interface{}, instr *PaymentInstruction) (*PaymentStatus, error)
	GetPaymentStatus(ctx interface{}, instructionID string) (*PaymentStatus, error)

	// Loan operations
	GetLoan(ctx interface{}, loanRef string) (*AgriLoan, error)
	GetLoansByBorrower(ctx interface{}, borrowerID string) ([]*AgriLoan, error)
	DisburseInputLoan(ctx interface{}, loan *AgriLoan) (*AgriLoan, error)
	RecordRepayment(ctx interface{}, loanRef string, amount decimal.Decimal) (*AgriLoan, error)

	// Health
	Ping(ctx interface{}) error
	Name() string
}
