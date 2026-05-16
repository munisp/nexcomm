// worker.go — Temporal worker registration for all NEXCOM workflows and activities.
// Called when the service is started with --mode=worker.
package temporal

import (
	"fmt"
	"os"

	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.uber.org/zap"
)

const (
	TaskQueueMain = "nexcom-main"
)

// RunWorker starts the Temporal worker, registers all workflows and activities,
// and blocks until the process receives a termination signal.
func RunWorker(logger *zap.SugaredLogger, activities *ActivityWorker) error {
	temporalAddr := os.Getenv("TEMPORAL_ADDRESS")
	if temporalAddr == "" {
		temporalAddr = "localhost:7233"
	}
	namespace := os.Getenv("TEMPORAL_NAMESPACE")
	if namespace == "" {
		namespace = "nexcom"
	}

	c, err := client.Dial(client.Options{
		HostPort:  temporalAddr,
		Namespace: namespace,
	})
	if err != nil {
		return fmt.Errorf("temporal: failed to dial server at %s: %w", temporalAddr, err)
	}
	defer c.Close()

	logger.Infow("Connected to Temporal", "address", temporalAddr, "namespace", namespace)

	// Create worker for all task queues
	queues := []string{
		TaskQueueMain,
		TaskQueueSettlement,
		TaskQueueKYC,
		TaskQueueAML,
		TaskQueueDelivery,
		TaskQueueAudit,
	}

	workers := make([]worker.Worker, 0, len(queues))
	for _, q := range queues {
		w := worker.New(c, q, worker.Options{})

		// Register workflows
		w.RegisterWorkflow(SettlementWorkflow)
		w.RegisterWorkflow(KYCReviewWorkflow)
		w.RegisterWorkflow(AMLScreeningWorkflow)
		w.RegisterWorkflow(LoanDisbursementWorkflow)
		w.RegisterWorkflow(SettlementFinalizeWorkflow)

		// Register activities
		w.RegisterActivity(activities.ScreenAML)
		w.RegisterActivity(activities.LockCommodityToken)
		w.RegisterActivity(activities.UnlockCommodityToken)
		w.RegisterActivity(activities.InitiateMojaloopTransfer)
		w.RegisterActivity(activities.RecordTigerBeetle)
		w.RegisterActivity(activities.TransferCommodityToken)
		w.RegisterActivity(activities.EmitSettlementEvent)
		w.RegisterActivity(activities.VerifyDocuments)
		w.RegisterActivity(activities.ScreenSanctions)
		w.RegisterActivity(activities.ComputeAMLRiskScore)
		w.RegisterActivity(activities.NotifyKYCDecision)
		w.RegisterActivity(activities.CreditCheck)
		w.RegisterActivity(activities.ReserveFunds)
		w.RegisterActivity(activities.DisburseLoan)
		w.RegisterActivity(activities.EmitLoanEvent)
		w.RegisterActivity(activities.GenerateSettlementNote)
		w.RegisterActivity(activities.ArchiveToLakehouse)
		w.RegisterActivity(activities.NotifyCounterparties)

		workers = append(workers, w)
	}

	// Start all workers
	for _, w := range workers {
		if err := w.Start(); err != nil {
			return fmt.Errorf("temporal: failed to start worker: %w", err)
		}
	}
	defer func() {
		for _, w := range workers {
			w.Stop()
		}
	}()

	logger.Infow("Temporal worker started",
		"task_queues", queues,
		"workflows", []string{
			"SettlementWorkflow",
			"KYCReviewWorkflow",
			"AMLScreeningWorkflow",
			"LoanDisbursementWorkflow",
			"SettlementFinalizeWorkflow",
		},
	)

	// Block until the first worker stops (all share the same lifecycle)
	workers[0].Run(worker.InterruptCh())
	return nil
}
