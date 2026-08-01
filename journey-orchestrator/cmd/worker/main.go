// Package main implements the Temporal worker for all 20 NEXCOM journey workflows.
// This worker registers every workflow and activity function and polls the Temporal
// server for work. It is designed to run as a long-lived process in Docker/Kubernetes.
package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"

	"github.com/munisp/nexcomm/journey-orchestrator/internal/activities"
	"github.com/munisp/nexcomm/journey-orchestrator/internal/config"
	"github.com/munisp/nexcomm/journey-orchestrator/internal/workflows"
)

// Task queues — one per domain to allow independent scaling
const (
	TaskQueueOnboarding  = "nexcom-onboarding"
	TaskQueueTrading     = "nexcom-trading"
	TaskQueueBanking     = "nexcom-banking"
	TaskQueueCompliance  = "nexcom-compliance"
	TaskQueueOperations  = "nexcom-operations"
)

func main() {
	cfg := config.Load()

	// Connect to Temporal server
	c, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalAddr,
		Namespace: cfg.TemporalNS,
	})
	if err != nil {
		log.Fatalf("Failed to connect to Temporal: %v", err)
	}
	defer c.Close()

	// Create activity registry (wired to all real services)
	acts := activities.New(cfg)

	// ── Onboarding Worker ─────────────────────────────────────────────────────
	onboardingWorker := worker.New(c, TaskQueueOnboarding, worker.Options{
		MaxConcurrentActivityExecutionSize:     50,
		MaxConcurrentWorkflowTaskExecutionSize: 20,
	})
	// Workflows
	onboardingWorker.RegisterWorkflow(workflows.FarmerOnboardingWorkflow)
	onboardingWorker.RegisterWorkflow(workflows.KYCAMLReviewWorkflow)
	onboardingWorker.RegisterWorkflow(workflows.WarehouseReceiptWorkflow)
	onboardingWorker.RegisterWorkflow(workflows.BrokerOnboardingWorkflow)
	// Activities
	registerAllActivities(onboardingWorker, acts)

	// ── Trading Worker ────────────────────────────────────────────────────────
	tradingWorker := worker.New(c, TaskQueueTrading, worker.Options{
		MaxConcurrentActivityExecutionSize:     100,
		MaxConcurrentWorkflowTaskExecutionSize: 50,
	})
	tradingWorker.RegisterWorkflow(workflows.CommodityListingWorkflow)
	tradingWorker.RegisterWorkflow(workflows.SpotTradeWorkflow)
	tradingWorker.RegisterWorkflow(workflows.TradeSettlementWorkflow)
	tradingWorker.RegisterWorkflow(workflows.FuturesTradingWorkflow)
	tradingWorker.RegisterWorkflow(workflows.MarginCallWorkflow)
	tradingWorker.RegisterWorkflow(workflows.MarketMakerQuoteWorkflow)
	tradingWorker.RegisterWorkflow(workflows.USSDMobileTradeWorkflow)
	tradingWorker.RegisterWorkflow(workflows.CorporateActionWorkflow)
	registerAllActivities(tradingWorker, acts)

	// ── Banking Worker ────────────────────────────────────────────────────────
	bankingWorker := worker.New(c, TaskQueueBanking, worker.Options{
		MaxConcurrentActivityExecutionSize:     50,
		MaxConcurrentWorkflowTaskExecutionSize: 20,
	})
	bankingWorker.RegisterWorkflow(workflows.CrossBorderFXWorkflow)
	bankingWorker.RegisterWorkflow(workflows.DepositWithdrawalWorkflow)
	bankingWorker.RegisterWorkflow(workflows.LoanApplicationWorkflow)
	bankingWorker.RegisterWorkflow(workflows.LoanDisbursementWorkflow)
	registerAllActivities(bankingWorker, acts)

	// ── Compliance Worker ─────────────────────────────────────────────────────
	complianceWorker := worker.New(c, TaskQueueCompliance, worker.Options{
		MaxConcurrentActivityExecutionSize:     20,
		MaxConcurrentWorkflowTaskExecutionSize: 10,
	})
	complianceWorker.RegisterWorkflow(workflows.MarketSurveillanceWorkflow)
	complianceWorker.RegisterWorkflow(workflows.ComplianceAuditWorkflow)
	complianceWorker.RegisterWorkflow(workflows.RegulatorReportingWorkflow)
	registerAllActivities(complianceWorker, acts)

	// ── Operations Worker ─────────────────────────────────────────────────────
	operationsWorker := worker.New(c, TaskQueueOperations, worker.Options{
		MaxConcurrentActivityExecutionSize:     20,
		MaxConcurrentWorkflowTaskExecutionSize: 10,
	})
	operationsWorker.RegisterWorkflow(workflows.PlatformHealthCheckWorkflow)
	registerAllActivities(operationsWorker, acts)

	// Start all workers
	for _, w := range []worker.Worker{onboardingWorker, tradingWorker, bankingWorker, complianceWorker, operationsWorker} {
		if err := w.Start(); err != nil {
			log.Fatalf("Failed to start worker: %v", err)
		}
	}

	log.Printf("NEXCOM Journey Orchestrator started. Temporal: %s, Namespace: %s", cfg.TemporalAddr, cfg.TemporalNS)
	log.Printf("Workers: onboarding=%s, trading=%s, banking=%s, compliance=%s, operations=%s",
		TaskQueueOnboarding, TaskQueueTrading, TaskQueueBanking, TaskQueueCompliance, TaskQueueOperations)

	// Wait for shutdown signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("Shutting down NEXCOM Journey Orchestrator...")
}

// registerAllActivities registers all activity functions on a worker.
// Activities are registered on every worker so any worker can execute any activity.
func registerAllActivities(w worker.Worker, acts *activities.Activities) {
	w.RegisterActivity(acts.SubmitKYC)
	w.RegisterActivity(acts.GetKYCStatus)
	w.RegisterActivity(acts.CheckKYCApproved)
	w.RegisterActivity(acts.AMLScreen)
	w.RegisterActivity(acts.CreateLedgerAccount)
	w.RegisterActivity(acts.GetAccountBalance)
	w.RegisterActivity(acts.CheckSufficientBalance)
	w.RegisterActivity(acts.ReserveFunds)
	w.RegisterActivity(acts.ReleaseFunds)
	w.RegisterActivity(acts.CreatePendingTransfer)
	w.RegisterActivity(acts.CommitPendingTransfer)
	w.RegisterActivity(acts.VoidPendingTransfer)
	w.RegisterActivity(acts.SettleTrade)
	w.RegisterActivity(acts.CollectTradingFee)
	w.RegisterActivity(acts.CreditUserAccount)
	w.RegisterActivity(acts.DebitUserAccount)
	w.RegisterActivity(acts.PlaceOrder)
	w.RegisterActivity(acts.CancelOrder)
	w.RegisterActivity(acts.PreTradeRiskCheck)
	w.RegisterActivity(acts.VerifyWarehouseCapacity)
	w.RegisterActivity(acts.IssueWarehouseReceipt)
	w.RegisterActivity(acts.VerifyWarehouseReceiptOwnership)
	w.RegisterActivity(acts.TransferWarehouseReceipt)
	w.RegisterActivity(acts.GetCommodityPrice)
	w.RegisterActivity(acts.TokenizeCommodity)
	w.RegisterActivity(acts.ExecuteBlockchainDvP)
	w.RegisterActivity(acts.SendNotification)
	w.RegisterActivity(acts.SendSMS)
	w.RegisterActivity(acts.IngestToLakehouse)
	w.RegisterActivity(acts.ProduceFluvio)
	w.RegisterActivity(acts.CheckPermission)
	w.RegisterActivity(acts.VerifyUserProfile)
	w.RegisterActivity(acts.AssignKeycloakRole)
	w.RegisterActivity(acts.FreezeAccount)
	w.RegisterActivity(acts.SuspendTradingAccount)
	w.RegisterActivity(acts.ScoreFarmer)
	w.RegisterActivity(acts.CreateLoanRecord)
	w.RegisterActivity(acts.ValidateLoanApproval)
	w.RegisterActivity(acts.ReserveLendingPoolFunds)
	w.RegisterActivity(acts.ReleaseLendingPoolFunds)
	w.RegisterActivity(acts.CommitLoanDisbursement)
	w.RegisterActivity(acts.StartRepaymentSchedule)
	w.RegisterActivity(acts.SanctionsScreening)
	w.RegisterActivity(acts.GetILPQuote)
	w.RegisterActivity(acts.ExecuteMojaloopTransfer)
	w.RegisterActivity(acts.ExecutePaymentGateway)
	w.RegisterActivity(acts.VerifyUSSDPIN)
	w.RegisterActivity(acts.GetMarginRequirements)
	w.RegisterActivity(acts.ReserveMargin)
	w.RegisterActivity(acts.CommitMarginReservation)
	w.RegisterActivity(acts.GetOpenPositions)
	w.RegisterActivity(acts.LiquidatePosition)
	w.RegisterActivity(acts.DetectTradingAnomaly)
	w.RegisterActivity(acts.GetUserTradingHistory)
	w.RegisterActivity(acts.RaiseSurveillanceAlert)
	w.RegisterActivity(acts.FileSuspiciousTransactionReport)
	w.RegisterActivity(acts.EscalateCase)
	w.RegisterActivity(acts.UpgradeKYCLevel)
	w.RegisterActivity(acts.IssueWarning)
	w.RegisterActivity(acts.GenerateComplianceReport)
	w.RegisterActivity(acts.RunAuditAnomalyDetection)
	w.RegisterActivity(acts.FileComplianceAlert)
	w.RegisterActivity(acts.ValidateCorporateAction)
	w.RegisterActivity(acts.GetHoldersAtRecordDate)
	w.RegisterActivity(acts.ProcessCorporateActionForHolder)
	w.RegisterActivity(acts.ProcessCorporateActionOnEngine)
	w.RegisterActivity(acts.BroadcastCorporateActionNotification)
	w.RegisterActivity(acts.VerifyBrokerLicense)
	w.RegisterActivity(acts.RegisterBroker)
	w.RegisterActivity(acts.CheckCircuitBreaker)
	w.RegisterActivity(acts.CompileRegulatorReport)
	w.RegisterActivity(acts.SignAndEncryptReport)
	w.RegisterActivity(acts.SubmitToRegulator)
	w.RegisterActivity(acts.TriggerSettlementWorkflow)
	w.RegisterActivity(acts.CheckServiceHealth)
	w.RegisterActivity(acts.PreListingRiskCheck)
}
