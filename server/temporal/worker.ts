/**
 * NEXCOM Exchange — Temporal Worker Bootstrap (P2-B2)
 *
 * Starts a Temporal worker that executes margin call, liquidation,
 * KYC review timeout, and settlement reconciliation workflows.
 *
 * The worker is started as a background process within the Node.js server.
 * If the Temporal service is unavailable (e.g., in dev/sandbox), the worker
 * gracefully degrades and logs a warning without crashing the server.
 *
 * Environment variables:
 *   TEMPORAL_ADDRESS  — Temporal server gRPC address (default: localhost:7233)
 *   TEMPORAL_NAMESPACE — Temporal namespace (default: nexcom)
 */

// Temporal workflow task queues — defined in workflows.ts
const NEXCOM_TASK_QUEUES = ["nexcom-margin", "nexcom-kyc", "nexcom-settlement", "nexcom-liquidation"] as const;
type TaskQueue = typeof NEXCOM_TASK_QUEUES[number];

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "nexcom";

/**
 * Start the Temporal worker in a non-blocking, fault-tolerant manner.
 * Uses dynamic import so the server boots even if @temporalio/worker is absent.
 */
export async function startTemporalWorker(): Promise<void> {
  try {
    // Dynamic import — Temporal SDK is optional in sandbox/dev environments
    // Attempt to load Temporal SDK — optional dependency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let temporalWorker: any = null;
    try {
      // @ts-expect-error — @temporalio/worker is an optional peer dependency
      temporalWorker = await import("@temporalio/worker");
    } catch {
      throw new Error("@temporalio/worker not installed — skipping Temporal worker");
    }
    if (!temporalWorker) throw new Error("@temporalio/worker not available");

    const { Worker, NativeConnection } = temporalWorker as any;

    const connection = await (NativeConnection as any).connect({
      address: TEMPORAL_ADDRESS,
    });

    // Start one worker per task queue
    const workflowsPath = new URL("./workflows.js", import.meta.url).pathname;
    for (const taskQueue of NEXCOM_TASK_QUEUES) {
      const worker = await Worker.create({
        connection,
        namespace: TEMPORAL_NAMESPACE,
        taskQueue,
        workflowsPath,
        activities: await import("./activities"),
        maxConcurrentActivityTaskExecutions: 10,
        maxConcurrentWorkflowTaskExecutions: 5,
      });

      console.info(`[Temporal] Worker started — namespace: ${TEMPORAL_NAMESPACE}, taskQueue: ${taskQueue}`);

      // Run in background — does not block the Express server
      worker.run().catch((err: Error) => {
        console.error(`[Temporal] Worker crashed (${taskQueue}):`, err.message);
      });
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Graceful degradation — Temporal is optional infrastructure
    if (msg.includes("not installed") || msg.includes("ECONNREFUSED") || msg.includes("UNAVAILABLE")) {
      console.warn(`[Temporal] Worker not started (service unavailable): ${msg}`);
    } else {
      console.error("[Temporal] Worker failed to start:", msg);
    }
  }
}

/**
 * Temporal workflow status endpoint helper.
 * Returns a summary of the worker's task queue and namespace for health checks.
 */
export function getTemporalStatus(): { address: string; namespace: string; taskQueues: readonly string[] } {
  return {
    address: TEMPORAL_ADDRESS,
    namespace: TEMPORAL_NAMESPACE,
    taskQueues: NEXCOM_TASK_QUEUES,
  };
}
