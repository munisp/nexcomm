// Package main implements the NEXCOM Exchange Commodity Tokenization Chaincode
// for Hyperledger Fabric.
//
// This chaincode manages the full lifecycle of commodity tokens on the
// permissioned Hyperledger Fabric network:
//
//  1. MintToken          – Create a new commodity token backed by a warehouse receipt
//  2. TransferToken      – Transfer token ownership between participants
//  3. FractionalizeToken – Split a token into N equal fractions
//  4. RedeemToken        – Burn a token when the commodity is physically withdrawn
//  5. QueryToken         – Read a single token by ID
//  6. QueryTokensByOwner – List all tokens owned by a given participant
//  7. QueryAllTokens     – Paginated scan of all tokens (admin)
//  8. GetHistory         – Full audit trail for a token
//  9. LockToken          – Lock a token during settlement / bridge transfer
// 10. UnlockToken        – Release a lock after settlement completes
//
// State model
// ───────────
// Each token is stored under the composite key  "TOKEN~{tokenId}".
// Owner index:  "OWNER~{ownerId}~{tokenId}" → "" (empty value, used for range queries).
//
// Access control
// ──────────────
// MintToken and RedeemToken require the caller to belong to the "exchange-msp" MSP
// (the NEXCOM exchange operator). All other functions are open to any enrolled
// participant on the channel.
package main

import (
	"encoding/json"
	"fmt"
	"time"

	"github.com/hyperledger/fabric-contract-api-go/v2/contractapi"
)

// ─── Data Structures ────────────────────────────────────────────────────────

// TokenStatus represents the lifecycle state of a commodity token.
type TokenStatus string

const (
	StatusMinting    TokenStatus = "MINTING"
	StatusActive     TokenStatus = "ACTIVE"
	StatusLocked     TokenStatus = "LOCKED"
	StatusInTransfer TokenStatus = "IN_TRANSFER"
	StatusRedeemed   TokenStatus = "REDEEMED"
	StatusBurned     TokenStatus = "BURNED"
)

// CommodityToken is the on-ledger representation of a tokenized commodity.
type CommodityToken struct {
	TokenID            string      `json:"tokenId"`
	CommoditySymbol    string      `json:"commoditySymbol"`
	Quantity           string      `json:"quantity"`
	Unit               string      `json:"unit"`
	OwnerID            string      `json:"ownerId"`
	WarehouseReceiptID string      `json:"warehouseReceiptId"`
	WarehouseLocation  string      `json:"warehouseLocation"`
	QualityGrade       string      `json:"qualityGrade"`
	MetadataCID        string      `json:"metadataCid"`   // IPFS CID of off-chain metadata
	Status             TokenStatus `json:"status"`
	IsFractionalized   bool        `json:"isFractionalized"`
	TotalFractions     int64       `json:"totalFractions"`
	LockRef            string      `json:"lockRef,omitempty"`   // settlement / bridge reference
	CreatedAt          string      `json:"createdAt"`
	UpdatedAt          string      `json:"updatedAt"`
	ExchangeMSP        string      `json:"exchangeMsp"`         // MSP that minted the token
}

// FractionToken represents one fraction of a fractionalized commodity token.
type FractionToken struct {
	FractionID      string `json:"fractionId"`
	ParentTokenID   string `json:"parentTokenId"`
	FractionIndex   int64  `json:"fractionIndex"`
	OwnerID         string `json:"ownerId"`
	PricePerFraction string `json:"pricePerFraction"`
	Currency        string `json:"currency"`
	Status          string `json:"status"`
	CreatedAt       string `json:"createdAt"`
}

// HistoryEntry is a single entry in a token's audit trail.
type HistoryEntry struct {
	TxID      string          `json:"txId"`
	Timestamp string          `json:"timestamp"`
	IsDelete  bool            `json:"isDelete"`
	Value     *CommodityToken `json:"value,omitempty"`
}

// ─── Smart Contract ──────────────────────────────────────────────────────────

// NexcomCommodityContract implements the commodity tokenization chaincode.
type NexcomCommodityContract struct {
	contractapi.Contract
}

const (
	tokenPrefix    = "TOKEN"
	ownerPrefix    = "OWNER"
	fractionPrefix = "FRACTION"
	exchangeMSP    = "exchange-msp" // MSP ID of the NEXCOM exchange operator
)

// ─── Helper functions ────────────────────────────────────────────────────────

func now() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func tokenKey(tokenID string) string {
	return fmt.Sprintf("%s~%s", tokenPrefix, tokenID)
}

func ownerKey(ownerID, tokenID string) string {
	return fmt.Sprintf("%s~%s~%s", ownerPrefix, ownerID, tokenID)
}

func fractionKey(fractionID string) string {
	return fmt.Sprintf("%s~%s", fractionPrefix, fractionID)
}

// requireExchangeMSP returns an error if the caller is not from the exchange MSP.
func requireExchangeMSP(ctx contractapi.TransactionContextInterface) error {
	mspID, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return fmt.Errorf("failed to get caller MSP: %w", err)
	}
	if mspID != exchangeMSP {
		return fmt.Errorf("access denied: operation requires %s membership, caller is %s", exchangeMSP, mspID)
	}
	return nil
}

// putToken marshals and stores a token, maintaining the owner index.
func putToken(ctx contractapi.TransactionContextInterface, token *CommodityToken) error {
	data, err := json.Marshal(token)
	if err != nil {
		return fmt.Errorf("marshal token: %w", err)
	}
	if err := ctx.GetStub().PutState(tokenKey(token.TokenID), data); err != nil {
		return fmt.Errorf("put token state: %w", err)
	}
	// Maintain owner index
	if err := ctx.GetStub().PutState(ownerKey(token.OwnerID, token.TokenID), []byte{}); err != nil {
		return fmt.Errorf("put owner index: %w", err)
	}
	return nil
}

// getToken retrieves a token by ID. Returns an error if not found.
func getToken(ctx contractapi.TransactionContextInterface, tokenID string) (*CommodityToken, error) {
	data, err := ctx.GetStub().GetState(tokenKey(tokenID))
	if err != nil {
		return nil, fmt.Errorf("get token state: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("token %s does not exist", tokenID)
	}
	var token CommodityToken
	if err := json.Unmarshal(data, &token); err != nil {
		return nil, fmt.Errorf("unmarshal token: %w", err)
	}
	return &token, nil
}

// ─── Chaincode Functions ─────────────────────────────────────────────────────

// MintToken creates a new commodity token backed by a warehouse receipt.
// Restricted to the exchange-msp operator.
//
// Parameters:
//
//	tokenID            – unique identifier (e.g. "TKN-MAIZE-a1b2c3d4")
//	commoditySymbol    – e.g. "MAIZE", "GINGER", "SOYBEAN"
//	quantity           – numeric string, e.g. "500"
//	unit               – "MT", "KG", "BAG"
//	ownerID            – participant account ID
//	warehouseReceiptID – EWR reference
//	warehouseLocation  – e.g. "Lagos Bonded Warehouse"
//	qualityGrade       – e.g. "Grade A"
//	metadataCID        – IPFS CID of the off-chain JSON metadata
func (c *NexcomCommodityContract) MintToken(
	ctx contractapi.TransactionContextInterface,
	tokenID, commoditySymbol, quantity, unit,
	ownerID, warehouseReceiptID, warehouseLocation,
	qualityGrade, metadataCID string,
) (*CommodityToken, error) {
	if err := requireExchangeMSP(ctx); err != nil {
		return nil, err
	}
	// Idempotency check
	existing, err := ctx.GetStub().GetState(tokenKey(tokenID))
	if err != nil {
		return nil, fmt.Errorf("check existing token: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("token %s already exists", tokenID)
	}
	if tokenID == "" || commoditySymbol == "" || quantity == "" || ownerID == "" || warehouseReceiptID == "" {
		return nil, fmt.Errorf("tokenID, commoditySymbol, quantity, ownerID, and warehouseReceiptID are required")
	}

	mspID, _ := ctx.GetClientIdentity().GetMSPID()
	ts := now()
	token := &CommodityToken{
		TokenID:            tokenID,
		CommoditySymbol:    commoditySymbol,
		Quantity:           quantity,
		Unit:               unit,
		OwnerID:            ownerID,
		WarehouseReceiptID: warehouseReceiptID,
		WarehouseLocation:  warehouseLocation,
		QualityGrade:       qualityGrade,
		MetadataCID:        metadataCID,
		Status:             StatusActive,
		IsFractionalized:   false,
		TotalFractions:     0,
		CreatedAt:          ts,
		UpdatedAt:          ts,
		ExchangeMSP:        mspID,
	}
	if err := putToken(ctx, token); err != nil {
		return nil, err
	}
	// Emit event for off-chain listeners
	payload, _ := json.Marshal(map[string]string{
		"event":   "TokenMinted",
		"tokenId": tokenID,
		"owner":   ownerID,
		"symbol":  commoditySymbol,
	})
	_ = ctx.GetStub().SetEvent("TokenMinted", payload)
	return token, nil
}

// TransferToken transfers ownership of a token to a new owner.
// The token must be in ACTIVE status and not locked.
//
// Parameters:
//
//	tokenID  – the token to transfer
//	newOwner – the recipient participant account ID
func (c *NexcomCommodityContract) TransferToken(
	ctx contractapi.TransactionContextInterface,
	tokenID, newOwner string,
) (*CommodityToken, error) {
	if tokenID == "" || newOwner == "" {
		return nil, fmt.Errorf("tokenID and newOwner are required")
	}
	token, err := getToken(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if token.Status != StatusActive {
		return nil, fmt.Errorf("token %s is not transferable in status %s", tokenID, token.Status)
	}
	// Verify caller is the current owner (or exchange MSP on behalf of owner)
	callerID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return nil, fmt.Errorf("get caller ID: %w", err)
	}
	mspID, _ := ctx.GetClientIdentity().GetMSPID()
	if callerID != token.OwnerID && mspID != exchangeMSP {
		return nil, fmt.Errorf("transfer denied: caller %s is not the token owner", callerID)
	}

	// Remove old owner index
	_ = ctx.GetStub().DelState(ownerKey(token.OwnerID, tokenID))

	prevOwner := token.OwnerID
	token.OwnerID = newOwner
	token.Status = StatusActive
	token.UpdatedAt = now()

	if err := putToken(ctx, token); err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{
		"event":     "TokenTransferred",
		"tokenId":   tokenID,
		"fromOwner": prevOwner,
		"toOwner":   newOwner,
	})
	_ = ctx.GetStub().SetEvent("TokenTransferred", payload)
	return token, nil
}

// FractionalizeToken splits a token into totalFractions equal fractions.
// Each fraction is stored as a separate FractionToken keyed by
// "FRACTION~{tokenID}~{index}".
// The parent token status is set to LOCKED after fractionalization.
//
// Parameters:
//
//	tokenID        – the token to fractionalize
//	totalFractions – number of fractions (must be > 1)
//	pricePerFraction – indicative price per fraction (string, e.g. "1000")
//	currency       – ISO 4217 currency code, e.g. "NGN"
func (c *NexcomCommodityContract) FractionalizeToken(
	ctx contractapi.TransactionContextInterface,
	tokenID string,
	totalFractions int64,
	pricePerFraction, currency string,
) (string, error) {
	if totalFractions < 2 {
		return "", fmt.Errorf("totalFractions must be at least 2")
	}
	token, err := getToken(ctx, tokenID)
	if err != nil {
		return "", err
	}
	if token.Status != StatusActive {
		return "", fmt.Errorf("token %s must be ACTIVE to fractionalize, current status: %s", tokenID, token.Status)
	}
	if token.IsFractionalized {
		return "", fmt.Errorf("token %s is already fractionalized", tokenID)
	}
	// Verify caller is owner or exchange MSP
	callerID, _ := ctx.GetClientIdentity().GetID()
	mspID, _ := ctx.GetClientIdentity().GetMSPID()
	if callerID != token.OwnerID && mspID != exchangeMSP {
		return "", fmt.Errorf("fractionalize denied: caller is not the token owner")
	}

	ts := now()
	for i := int64(0); i < totalFractions; i++ {
		fractionID := fmt.Sprintf("%s-F%04d", tokenID, i)
		fraction := &FractionToken{
			FractionID:       fractionID,
			ParentTokenID:    tokenID,
			FractionIndex:    i,
			OwnerID:          token.OwnerID,
			PricePerFraction: pricePerFraction,
			Currency:         currency,
			Status:           "ACTIVE",
			CreatedAt:        ts,
		}
		data, err := json.Marshal(fraction)
		if err != nil {
			return "", fmt.Errorf("marshal fraction %d: %w", i, err)
		}
		if err := ctx.GetStub().PutState(fractionKey(fractionID), data); err != nil {
			return "", fmt.Errorf("put fraction %d: %w", i, err)
		}
	}

	// Update parent token
	token.IsFractionalized = true
	token.TotalFractions = totalFractions
	token.Status = StatusLocked
	token.UpdatedAt = ts
	if err := putToken(ctx, token); err != nil {
		return "", err
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"event":          "TokenFractionalized",
		"tokenId":        tokenID,
		"totalFractions": totalFractions,
	})
	_ = ctx.GetStub().SetEvent("TokenFractionalized", payload)
	return fmt.Sprintf("token %s fractionalized into %d fractions", tokenID, totalFractions), nil
}

// RedeemToken burns a token when the physical commodity is withdrawn from
// the warehouse. Restricted to the exchange-msp operator.
//
// Parameters:
//
//	tokenID – the token to redeem
//	reason  – free-text reason (e.g. "Physical withdrawal by owner")
func (c *NexcomCommodityContract) RedeemToken(
	ctx contractapi.TransactionContextInterface,
	tokenID, reason string,
) (*CommodityToken, error) {
	if err := requireExchangeMSP(ctx); err != nil {
		return nil, err
	}
	token, err := getToken(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if token.Status == StatusRedeemed || token.Status == StatusBurned {
		return nil, fmt.Errorf("token %s is already %s", tokenID, token.Status)
	}
	token.Status = StatusRedeemed
	token.UpdatedAt = now()
	if err := putToken(ctx, token); err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{
		"event":   "TokenRedeemed",
		"tokenId": tokenID,
		"owner":   token.OwnerID,
		"reason":  reason,
	})
	_ = ctx.GetStub().SetEvent("TokenRedeemed", payload)
	return token, nil
}

// LockToken places a lock on a token during settlement or cross-chain bridge
// operations. Restricted to the exchange-msp operator.
//
// Parameters:
//
//	tokenID – the token to lock
//	lockRef – settlement ID or bridge transfer ID
func (c *NexcomCommodityContract) LockToken(
	ctx contractapi.TransactionContextInterface,
	tokenID, lockRef string,
) (*CommodityToken, error) {
	if err := requireExchangeMSP(ctx); err != nil {
		return nil, err
	}
	token, err := getToken(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if token.Status != StatusActive {
		return nil, fmt.Errorf("token %s cannot be locked in status %s", tokenID, token.Status)
	}
	token.Status = StatusLocked
	token.LockRef = lockRef
	token.UpdatedAt = now()
	if err := putToken(ctx, token); err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{
		"event":   "TokenLocked",
		"tokenId": tokenID,
		"lockRef": lockRef,
	})
	_ = ctx.GetStub().SetEvent("TokenLocked", payload)
	return token, nil
}

// UnlockToken releases a lock after settlement or bridge transfer completes.
// Restricted to the exchange-msp operator.
//
// Parameters:
//
//	tokenID – the token to unlock
func (c *NexcomCommodityContract) UnlockToken(
	ctx contractapi.TransactionContextInterface,
	tokenID string,
) (*CommodityToken, error) {
	if err := requireExchangeMSP(ctx); err != nil {
		return nil, err
	}
	token, err := getToken(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if token.Status != StatusLocked {
		return nil, fmt.Errorf("token %s is not locked (status: %s)", tokenID, token.Status)
	}
	token.Status = StatusActive
	token.LockRef = ""
	token.UpdatedAt = now()
	if err := putToken(ctx, token); err != nil {
		return nil, err
	}
	payload, _ := json.Marshal(map[string]string{
		"event":   "TokenUnlocked",
		"tokenId": tokenID,
	})
	_ = ctx.GetStub().SetEvent("TokenUnlocked", payload)
	return token, nil
}

// QueryToken returns a single token by ID.
func (c *NexcomCommodityContract) QueryToken(
	ctx contractapi.TransactionContextInterface,
	tokenID string,
) (*CommodityToken, error) {
	return getToken(ctx, tokenID)
}

// QueryTokensByOwner returns all tokens owned by a given participant.
// Uses the OWNER~ composite key index for efficient lookup.
func (c *NexcomCommodityContract) QueryTokensByOwner(
	ctx contractapi.TransactionContextInterface,
	ownerID string,
) ([]*CommodityToken, error) {
	if ownerID == "" {
		return nil, fmt.Errorf("ownerID is required")
	}
	prefix := fmt.Sprintf("%s~%s~", ownerPrefix, ownerID)
	iter, err := ctx.GetStub().GetStateByRange(prefix, prefix+"\xFF")
	if err != nil {
		return nil, fmt.Errorf("owner index range query: %w", err)
	}
	defer iter.Close()

	var tokens []*CommodityToken
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate owner index: %w", err)
		}
		// Extract tokenID from key "OWNER~{ownerID}~{tokenID}"
		key := kv.Key
		tokenID := ""
		for i := len(prefix); i < len(key); i++ {
			tokenID += string(key[i])
		}
		token, err := getToken(ctx, tokenID)
		if err != nil {
			continue // skip if token was deleted
		}
		tokens = append(tokens, token)
	}
	return tokens, nil
}

// QueryAllTokens returns a paginated list of all tokens on the ledger.
// Intended for admin / analytics use.
//
// Parameters:
//
//	pageSize  – number of tokens per page (max 100)
//	bookmark  – pagination cursor from a previous call ("" for first page)
func (c *NexcomCommodityContract) QueryAllTokens(
	ctx contractapi.TransactionContextInterface,
	pageSize int32,
	bookmark string,
) (string, error) {
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	prefix := tokenPrefix + "~"
	iter, meta, err := ctx.GetStub().GetStateByRangeWithPagination(
		prefix, prefix+"\xFF", pageSize, bookmark,
	)
	if err != nil {
		return "", fmt.Errorf("paginated range query: %w", err)
	}
	defer iter.Close()

	var tokens []*CommodityToken
	for iter.HasNext() {
		kv, err := iter.Next()
		if err != nil {
			return "", fmt.Errorf("iterate tokens: %w", err)
		}
		var token CommodityToken
		if err := json.Unmarshal(kv.Value, &token); err != nil {
			continue
		}
		tokens = append(tokens, &token)
	}
	result := map[string]interface{}{
		"tokens":   tokens,
		"bookmark": meta.Bookmark,
		"count":    len(tokens),
	}
	out, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("marshal result: %w", err)
	}
	return string(out), nil
}

// GetHistory returns the full audit trail for a token, including all
// historical states and the transactions that produced them.
func (c *NexcomCommodityContract) GetHistory(
	ctx contractapi.TransactionContextInterface,
	tokenID string,
) ([]*HistoryEntry, error) {
	iter, err := ctx.GetStub().GetHistoryForKey(tokenKey(tokenID))
	if err != nil {
		return nil, fmt.Errorf("get history: %w", err)
	}
	defer iter.Close()

	var history []*HistoryEntry
	for iter.HasNext() {
		mod, err := iter.Next()
		if err != nil {
			return nil, fmt.Errorf("iterate history: %w", err)
		}
		entry := &HistoryEntry{
			TxID:      mod.TxId,
			Timestamp: time.Unix(mod.Timestamp.Seconds, int64(mod.Timestamp.Nanos)).UTC().Format(time.RFC3339),
			IsDelete:  mod.IsDelete,
		}
		if !mod.IsDelete && len(mod.Value) > 0 {
			var token CommodityToken
			if err := json.Unmarshal(mod.Value, &token); err == nil {
				entry.Value = &token
			}
		}
		history = append(history, entry)
	}
	return history, nil
}

// QueryFraction returns a single fraction token by its fraction ID.
func (c *NexcomCommodityContract) QueryFraction(
	ctx contractapi.TransactionContextInterface,
	fractionID string,
) (*FractionToken, error) {
	data, err := ctx.GetStub().GetState(fractionKey(fractionID))
	if err != nil {
		return nil, fmt.Errorf("get fraction state: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("fraction %s does not exist", fractionID)
	}
	var fraction FractionToken
	if err := json.Unmarshal(data, &fraction); err != nil {
		return nil, fmt.Errorf("unmarshal fraction: %w", err)
	}
	return &fraction, nil
}

// TransferFraction transfers a single fraction to a new owner.
//
// Parameters:
//
//	fractionID – the fraction to transfer (e.g. "TKN-MAIZE-a1b2c3d4-F0001")
//	newOwner   – recipient participant account ID
func (c *NexcomCommodityContract) TransferFraction(
	ctx contractapi.TransactionContextInterface,
	fractionID, newOwner string,
) (*FractionToken, error) {
	if fractionID == "" || newOwner == "" {
		return nil, fmt.Errorf("fractionID and newOwner are required")
	}
	data, err := ctx.GetStub().GetState(fractionKey(fractionID))
	if err != nil {
		return nil, fmt.Errorf("get fraction: %w", err)
	}
	if data == nil {
		return nil, fmt.Errorf("fraction %s does not exist", fractionID)
	}
	var fraction FractionToken
	if err := json.Unmarshal(data, &fraction); err != nil {
		return nil, fmt.Errorf("unmarshal fraction: %w", err)
	}
	if fraction.Status != "ACTIVE" {
		return nil, fmt.Errorf("fraction %s is not transferable (status: %s)", fractionID, fraction.Status)
	}
	// Verify caller is the fraction owner or exchange MSP
	callerID, _ := ctx.GetClientIdentity().GetID()
	mspID, _ := ctx.GetClientIdentity().GetMSPID()
	if callerID != fraction.OwnerID && mspID != exchangeMSP {
		return nil, fmt.Errorf("transfer denied: caller is not the fraction owner")
	}

	fraction.OwnerID = newOwner
	updated, err := json.Marshal(fraction)
	if err != nil {
		return nil, fmt.Errorf("marshal updated fraction: %w", err)
	}
	if err := ctx.GetStub().PutState(fractionKey(fractionID), updated); err != nil {
		return nil, fmt.Errorf("put updated fraction: %w", err)
	}
	payload, _ := json.Marshal(map[string]string{
		"event":      "FractionTransferred",
		"fractionId": fractionID,
		"toOwner":    newOwner,
	})
	_ = ctx.GetStub().SetEvent("FractionTransferred", payload)
	return &fraction, nil
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

func main() {
	cc, err := contractapi.NewChaincode(&NexcomCommodityContract{})
	if err != nil {
		panic(fmt.Sprintf("Error creating NexcomCommodityContract chaincode: %v", err))
	}
	if err := cc.Start(); err != nil {
		panic(fmt.Sprintf("Error starting NexcomCommodityContract chaincode: %v", err))
	}
}
