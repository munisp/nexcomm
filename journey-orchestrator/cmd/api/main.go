// Package main implements the HTTP API server for triggering NEXCOM journey workflows.
// Exposes POST /journeys/:name to start any of the 20 reusable journeys.
// Also exposes GET /journeys/:workflowId/status and POST /journeys/:workflowId/signal.
package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"go.temporal.io/sdk/client"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/config"
	"github.com/munisp/nexcomm/journey-orchestrator/internal/workflows"
)

// journeyRegistry maps journey names to their task queues and input types.
var journeyRegistry = map[string]string{
	"FarmerOnboarding":       "nexcom-onboarding",
	"KYCAMLReview":           "nexcom-onboarding",
	"WarehouseReceipt":       "nexcom-onboarding",
	"BrokerOnboarding":       "nexcom-onboarding",
	"CommodityListing":       "nexcom-trading",
	"SpotTrade":              "nexcom-trading",
	"TradeSettlement":        "nexcom-trading",
	"FuturesTrading":         "nexcom-trading",
	"MarginCall":             "nexcom-trading",
	"MarketMakerQuote":       "nexcom-trading",
	"USSDMobileTrade":        "nexcom-trading",
	"CorporateAction":        "nexcom-trading",
	"CrossBorderFX":          "nexcom-banking",
	"DepositWithdrawal":      "nexcom-banking",
	"LoanApplication":        "nexcom-banking",
	"LoanDisbursement":       "nexcom-banking",
	"MarketSurveillance":     "nexcom-compliance",
	"ComplianceAudit":        "nexcom-compliance",
	"RegulatorReporting":     "nexcom-compliance",
	"PlatformHealthCheck":    "nexcom-operations",
}

var temporalClient client.Client

func main() {
	cfg := config.Load()

	var err error
	temporalClient, err = client.Dial(client.Options{
		HostPort:  cfg.TemporalAddr,
		Namespace: cfg.TemporalNS,
	})
	if err != nil {
		log.Fatalf("Failed to connect to Temporal: %v", err)
	}
	defer temporalClient.Close()

	port := os.Getenv("JOURNEY_API_PORT")
	if port == "" {
		port = "8015"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/journeys", handleListJourneys)
	mux.HandleFunc("/journeys/", handleJourneyRequest)

	log.Printf("NEXCOM Journey API listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "healthy", "service": "journey-orchestrator",
		"journeys": len(journeyRegistry), "timestamp": time.Now().UTC(),
	})
}

func handleListJourneys(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type JourneyInfo struct {
		Name      string `json:"name"`
		TaskQueue string `json:"task_queue"`
		Endpoint  string `json:"endpoint"`
	}
	var journeys []JourneyInfo
	for name, queue := range journeyRegistry {
		journeys = append(journeys, JourneyInfo{
			Name:      name,
			TaskQueue: queue,
			Endpoint:  fmt.Sprintf("POST /journeys/%s/start", name),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"journeys": journeys,
		"count":    len(journeys),
	})
}

func handleJourneyRequest(w http.ResponseWriter, r *http.Request) {
	// Parse path: /journeys/{name}/start or /journeys/{workflowId}/status or /journeys/{workflowId}/signal
	path := r.URL.Path[len("/journeys/"):]
	parts := splitPath(path)
	if len(parts) < 2 {
		http.Error(w, "Invalid path. Use /journeys/{name}/start, /journeys/{id}/status, or /journeys/{id}/signal", http.StatusBadRequest)
		return
	}
	name := parts[0]
	action := parts[1]

	switch action {
	case "start":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleStartJourney(w, r, name)
	case "status":
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleGetStatus(w, r, name)
	case "signal":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleSignal(w, r, name)
	case "cancel":
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleCancel(w, r, name)
	default:
		http.Error(w, fmt.Sprintf("Unknown action: %s", action), http.StatusBadRequest)
	}
}

func handleStartJourney(w http.ResponseWriter, r *http.Request, journeyName string) {
	taskQueue, ok := journeyRegistry[journeyName]
	if !ok {
		http.Error(w, fmt.Sprintf("Unknown journey: %s. Valid journeys: %v", journeyName, journeyNames()), http.StatusBadRequest)
		return
	}

	var inputJSON map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&inputJSON); err != nil {
		http.Error(w, fmt.Sprintf("Invalid JSON body: %v", err), http.StatusBadRequest)
		return
	}

	// Build workflow ID (idempotent if provided)
	workflowID, _ := inputJSON["workflow_id"].(string)
	if workflowID == "" {
		workflowID = fmt.Sprintf("%s-%d", journeyName, time.Now().UnixMilli())
	}

	// Map journey name to workflow function and typed input
	workflowFn, typedInput, err := resolveWorkflow(journeyName, inputJSON)
	if err != nil {
		http.Error(w, fmt.Sprintf("Input error: %v", err), http.StatusBadRequest)
		return
	}

	// Start workflow
	opts := client.StartWorkflowOptions{
		ID:        workflowID,
		TaskQueue: taskQueue,
	}
	run, err := temporalClient.ExecuteWorkflow(r.Context(), opts, workflowFn, typedInput)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to start workflow: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflow_id": run.GetID(),
		"run_id":      run.GetRunID(),
		"journey":     journeyName,
		"task_queue":  taskQueue,
		"status":      "STARTED",
		"status_url":  fmt.Sprintf("/journeys/%s/status", run.GetID()),
		"started_at":  time.Now().UTC(),
	})
}

func handleGetStatus(w http.ResponseWriter, r *http.Request, workflowID string) {
	resp, err := temporalClient.DescribeWorkflowExecution(r.Context(), workflowID, "")
	if err != nil {
		http.Error(w, fmt.Sprintf("Workflow not found: %v", err), http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflow_id":    workflowID,
		"status":         resp.WorkflowExecutionInfo.Status.String(),
		"workflow_type":  resp.WorkflowExecutionInfo.Type.Name,
		"start_time":     resp.WorkflowExecutionInfo.StartTime,
		"close_time":     resp.WorkflowExecutionInfo.CloseTime,
		"history_length": resp.WorkflowExecutionInfo.HistoryLength,
	})
}

func handleSignal(w http.ResponseWriter, r *http.Request, workflowID string) {
	var body struct {
		SignalName string      `json:"signal_name"`
		Payload    interface{} `json:"payload"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}
	if err := temporalClient.SignalWorkflow(r.Context(), workflowID, "", body.SignalName, body.Payload); err != nil {
		http.Error(w, fmt.Sprintf("Signal failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflow_id": workflowID, "signal": body.SignalName, "status": "SIGNALED",
	})
}

func handleCancel(w http.ResponseWriter, r *http.Request, workflowID string) {
	if err := temporalClient.CancelWorkflow(r.Context(), workflowID, ""); err != nil {
		http.Error(w, fmt.Sprintf("Cancel failed: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"workflow_id": workflowID, "status": "CANCELLATION_REQUESTED",
	})
}

// resolveWorkflow maps a journey name to its workflow function and typed input.
func resolveWorkflow(name string, raw map[string]interface{}) (interface{}, interface{}, error) {
	b, _ := json.Marshal(raw)
	switch name {
	case "FarmerOnboarding":
		var input workflows.FarmerOnboardingInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.FarmerOnboardingWorkflow, input, nil
	case "KYCAMLReview":
		var input workflows.KYCAMLReviewInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.KYCAMLReviewWorkflow, input, nil
	case "WarehouseReceipt":
		var input workflows.WarehouseReceiptInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.WarehouseReceiptWorkflow, input, nil
	case "CommodityListing":
		var input workflows.CommodityListingInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.CommodityListingWorkflow, input, nil
	case "SpotTrade":
		var input workflows.SpotTradeInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.SpotTradeWorkflow, input, nil
	case "TradeSettlement":
		var input workflows.TradeSettlementInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.TradeSettlementWorkflow, input, nil
	case "FuturesTrading":
		var input workflows.FuturesTradingInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.FuturesTradingWorkflow, input, nil
	case "MarginCall":
		var input workflows.MarginCallInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.MarginCallWorkflow, input, nil
	case "CrossBorderFX":
		var input workflows.CrossBorderFXInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.CrossBorderFXWorkflow, input, nil
	case "DepositWithdrawal":
		var input workflows.DepositWithdrawalInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.DepositWithdrawalWorkflow, input, nil
	case "USSDMobileTrade":
		var input workflows.USSDMobileTradeInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.USSDMobileTradeWorkflow, input, nil
	case "LoanApplication":
		var input workflows.LoanApplicationInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.LoanApplicationWorkflow, input, nil
	case "LoanDisbursement":
		var input workflows.LoanDisbursementInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.LoanDisbursementWorkflow, input, nil
	case "CorporateAction":
		var input workflows.CorporateActionInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.CorporateActionWorkflow, input, nil
	case "MarketSurveillance":
		var input workflows.SurveillanceInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.MarketSurveillanceWorkflow, input, nil
	case "ComplianceAudit":
		var input workflows.ComplianceAuditInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.ComplianceAuditWorkflow, input, nil
	case "BrokerOnboarding":
		var input workflows.BrokerOnboardingInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.BrokerOnboardingWorkflow, input, nil
	case "MarketMakerQuote":
		var input workflows.MarketMakerQuoteInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.MarketMakerQuoteWorkflow, input, nil
	case "RegulatorReporting":
		var input workflows.RegulatorReportInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.RegulatorReportingWorkflow, input, nil
	case "PlatformHealthCheck":
		var input workflows.PlatformHealthInput
		if err := json.Unmarshal(b, &input); err != nil {
			return nil, nil, err
		}
		return workflows.PlatformHealthCheckWorkflow, input, nil
	default:
		return nil, nil, fmt.Errorf("unknown journey: %s", name)
	}
}

func journeyNames() []string {
	names := make([]string, 0, len(journeyRegistry))
	for k := range journeyRegistry {
		names = append(names, k)
	}
	return names
}

func splitPath(path string) []string {
	var parts []string
	current := ""
	for _, c := range path {
		if c == '/' {
			if current != "" {
				parts = append(parts, current)
				current = ""
			}
		} else {
			current += string(c)
		}
	}
	if current != "" {
		parts = append(parts, current)
	}
	return parts
}
