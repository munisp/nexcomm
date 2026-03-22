// Package models defines all domain types for the Mojaloop DFSP adapter.
package models

import "time"

// TransferStatus represents the FSPIOP transfer lifecycle state.
type TransferStatus string

const (
	TransferPending   TransferStatus = "PENDING"
	TransferReserved  TransferStatus = "RESERVED"
	TransferCommitted TransferStatus = "COMMITTED"
	TransferAborted   TransferStatus = "ABORTED"
	TransferExpired   TransferStatus = "EXPIRED"
)

// QuoteStatus represents the quote negotiation state.
type QuoteStatus string

const (
	QuotePending  QuoteStatus = "PENDING"
	QuoteAccepted QuoteStatus = "ACCEPTED"
	QuoteRejected QuoteStatus = "REJECTED"
	QuoteExpired  QuoteStatus = "EXPIRED"
)

// ─── FSPIOP Request/Response types ───────────────────────────────────────────

// PartyIDInfo identifies a party by type and identifier.
type PartyIDInfo struct {
	PartyIDType      string `json:"partyIdType"`
	PartyIdentifier  string `json:"partyIdentifier"`
	FspID            string `json:"fspId,omitempty"`
	PartySubIDOrType string `json:"partySubIdOrType,omitempty"`
}

// PartyComplexName holds name components.
type PartyComplexName struct {
	FirstName  string `json:"firstName,omitempty"`
	MiddleName string `json:"middleName,omitempty"`
	LastName   string `json:"lastName,omitempty"`
}

// PartyPersonalInfo holds personal information about a party.
type PartyPersonalInfo struct {
	ComplexName *PartyComplexName `json:"complexName,omitempty"`
	DateOfBirth string            `json:"dateOfBirth,omitempty"`
}

// Party represents a Mojaloop party (account holder).
type Party struct {
	PartyIDInfo  PartyIDInfo        `json:"partyIdInfo"`
	Name         string             `json:"name,omitempty"`
	PersonalInfo *PartyPersonalInfo `json:"personalInfo,omitempty"`
}

// Money represents a monetary amount with currency.
type Money struct {
	Amount   string `json:"amount"`
	Currency string `json:"currency"`
}

// TransactionType describes the nature of a transaction.
type TransactionType struct {
	Scenario     string `json:"scenario"`
	Initiator    string `json:"initiator"`
	InitiatorType string `json:"initiatorType"`
}

// QuoteRequest is the FSPIOP POST /quotes request body.
type QuoteRequest struct {
	QuoteID         string          `json:"quoteId"`
	TransactionID   string          `json:"transactionId"`
	PayerFsp        string          `json:"payerFsp"`
	PayeeFsp        string          `json:"payeeFsp"`
	Payer           *Party          `json:"payer"`
	Payee           *Party          `json:"payee"`
	AmountType      string          `json:"amountType"`
	Amount          Money           `json:"amount"`
	TransactionType TransactionType `json:"transactionType"`
	Note            string          `json:"note,omitempty"`
}

// QuoteResponse is the FSPIOP PUT /quotes/{id} response body.
type QuoteResponse struct {
	TransferAmount    Money  `json:"transferAmount"`
	PayeeReceiveAmount Money `json:"payeeReceiveAmount"`
	PayeeFspFee       Money  `json:"payeeFspFee"`
	Expiration        string `json:"expiration"`
	IlpPacket         string `json:"ilpPacket"`
	Condition         string `json:"condition"`
}

// TransferRequest is the FSPIOP POST /transfers request body.
type TransferRequest struct {
	TransferID  string `json:"transferId"`
	QuoteID     string `json:"quoteId,omitempty"`
	PayerFsp    string `json:"payerFsp"`
	PayeeFsp    string `json:"payeeFsp"`
	Payer       *Party `json:"payer,omitempty"`
	Payee       *Party `json:"payee,omitempty"`
	Amount      Money  `json:"amount"`
	IlpPacket   string `json:"ilpPacket,omitempty"`
	Condition   string `json:"condition,omitempty"`
	Expiration  string `json:"expiration,omitempty"`
}

// TransferFulfilRequest is the FSPIOP PUT /transfers/{id} callback body.
type TransferFulfilRequest struct {
	Fulfilment         string `json:"fulfilment,omitempty"`
	TransferState      string `json:"transferState"`
	CompletedTimestamp string `json:"completedTimestamp,omitempty"`
}

// ErrorInformation is the standard FSPIOP error response.
type ErrorInformation struct {
	ErrorCode        string `json:"errorCode"`
	ErrorDescription string `json:"errorDescription"`
}

// ErrorResponse wraps an FSPIOP error.
type ErrorResponse struct {
	ErrorInformation ErrorInformation `json:"errorInformation"`
}

// ─── DB row types ─────────────────────────────────────────────────────────────

// DBTransfer mirrors the mojaloop_transfers table row.
type DBTransfer struct {
	ID                 int            `json:"id"`
	TransferID         string         `json:"transferId"`
	QuoteID            *string        `json:"quoteId"`
	PayerFspID         string         `json:"payerFspId"`
	PayeeFspID         string         `json:"payeeFspId"`
	PayerIdentifier    string         `json:"payerIdentifier"`
	PayeeIdentifier    string         `json:"payeeIdentifier"`
	Amount             string         `json:"amount"`
	Currency           string         `json:"currency"`
	IlpPacket          *string        `json:"ilpPacket"`
	Condition          *string        `json:"condition"`
	Fulfilment         *string        `json:"fulfilment"`
	Expiration         *time.Time     `json:"expiration"`
	Status             TransferStatus `json:"status"`
	ErrorCode          *string        `json:"errorCode"`
	ErrorDescription   *string        `json:"errorDescription"`
	NexcomSettlementID *int           `json:"nexcomSettlementId"`
	NexcomOrderID      *int           `json:"nexcomOrderId"`
	ReservedAt         *time.Time     `json:"reservedAt"`
	CommittedAt        *time.Time     `json:"committedAt"`
	AbortedAt          *time.Time     `json:"abortedAt"`
	CreatedAt          time.Time      `json:"createdAt"`
	UpdatedAt          time.Time      `json:"updatedAt"`
}

// DBQuote mirrors the mojaloop_quotes table row.
type DBQuote struct {
	ID                 int         `json:"id"`
	QuoteID            string      `json:"quoteId"`
	TransactionID      string      `json:"transactionId"`
	PayerFspID         string      `json:"payerFspId"`
	PayeeFspID         string      `json:"payeeFspId"`
	PayerIdentifier    string      `json:"payerIdentifier"`
	PayeeIdentifier    string      `json:"payeeIdentifier"`
	AmountType         string      `json:"amountType"`
	Amount             string      `json:"amount"`
	Currency           string      `json:"currency"`
	FeeAmount          *string     `json:"feeAmount"`
	FeeCurrency        *string     `json:"feeCurrency"`
	TransferAmount     *string     `json:"transferAmount"`
	IlpPacket          *string     `json:"ilpPacket"`
	Condition          *string     `json:"condition"`
	Expiration         *time.Time  `json:"expiration"`
	Status             QuoteStatus `json:"status"`
	RejectReason       *string     `json:"rejectReason"`
	NexcomSettlementID *int        `json:"nexcomSettlementId"`
	CreatedAt          time.Time   `json:"createdAt"`
	UpdatedAt          time.Time   `json:"updatedAt"`
}

// DBDfsp mirrors the mojaloop_dfsps table row.
type DBDfsp struct {
	ID          int       `json:"id"`
	FspID       string    `json:"fspId"`
	Name        string    `json:"name"`
	Country     *string   `json:"country"`
	Currencies  []string  `json:"currencies"`
	IsActive    bool      `json:"isActive"`
	EndpointURL *string   `json:"endpointUrl"`
	CallbackURL *string   `json:"callbackUrl"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// DBParty mirrors the mojaloop_parties table row.
type DBParty struct {
	ID                  int       `json:"id"`
	PartyIDType         string    `json:"partyIdType"`
	PartyIdentifier     string    `json:"partyIdentifier"`
	FspID               string    `json:"fspId"`
	FirstName           *string   `json:"firstName"`
	LastName            *string   `json:"lastName"`
	DateOfBirth         *string   `json:"dateOfBirth"`
	MerchantClassCode   *string   `json:"merchantClassCode"`
	Currency            string    `json:"currency"`
	SupportedCurrencies []string  `json:"supportedCurrencies"`
	IsActive            bool      `json:"isActive"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

// StatsResponse is the /stats endpoint response.
type StatsResponse struct {
	DfspID         string                            `json:"dfspId"`
	ActiveDfsps    int                               `json:"activeDfsps"`
	Transfers      map[string]TransferStatEntry      `json:"transfers"`
	Quotes         map[string]int                    `json:"quotes"`
	RuntimeMetrics map[string]int64                  `json:"runtimeMetrics"`
}

// TransferStatEntry holds aggregated transfer stats per status.
type TransferStatEntry struct {
	Count       int     `json:"count"`
	TotalAmount float64 `json:"totalAmount"`
}
