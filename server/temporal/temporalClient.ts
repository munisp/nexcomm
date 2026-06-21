/**
 * temporalClient.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Temporal workflow client for NEXCOM Exchange.
 *
 * Provides a thin wrapper around the Temporal TypeScript SDK that:
 *   1. Connects to the Temporal server (address from TEMPORAL_ADDRESS env var)
 *   2. Exposes triggerTemporalWorkflow() for fire-and-forget workflow starts
 *   3. Exposes signalTemporalWorkflow() for sending signals to running workflows
 *   4. Gracefully degrades when Temporal is unavailable (logs warning, does not throw)
 *
 * The Go workflow workers (workflows/temporal/*) connect to the same Temporal
 * server and execute the actual workflow logic. This client only starts workflows.
 */

import { Connection, Client, WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "nexcom-exchange";
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "nexcom-fund-flows";

let _client: Client | null = null;
let _connectionFailed = false;

async function getTemporalClient(): Promise<Client | null> {
  if (_connectionFailed) return null;
  if (_client) return _client;

  try {
    const connection = await Connection.connect({
      address: TEMPORAL_ADDRESS,
      connectTimeout: "3s",
    });
    _client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
    console.log(`[Temporal] Connected to ${TEMPORAL_ADDRESS} namespace=${TEMPORAL_NAMESPACE}`);
    return _client;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Temporal] Could not connect to ${TEMPORAL_ADDRESS}: ${msg}. Workflows will not be triggered.`);
    _connectionFailed = true;
    return null;
  }
}

/**
 * Start a Temporal workflow. Idempotent — if a workflow with the same workflowId
 * is already running, the existing execution is reused (no duplicate).
 *
 * @param workflowType  The registered workflow function name (e.g. "DepositWorkflow")
 * @param input         Serialisable input payload
 * @param workflowId    Optional stable ID for idempotency (defaults to a UUID)
 */
export async function triggerTemporalWorkflow(
  workflowType: string,
  input: unknown,
  workflowId?: string
): Promise<string | null> {
  const client = await getTemporalClient();
  if (!client) return null;

  const id = workflowId ?? `${workflowType}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  try {
    const handle = await client.workflow.start(workflowType, {
      taskQueue: TEMPORAL_TASK_QUEUE,
      workflowId: id,
      args: [input],
    });
    console.log(`[Temporal] Started workflow ${workflowType} id=${handle.workflowId}`);
    return handle.workflowId;
  } catch (err: unknown) {
    if (err instanceof WorkflowExecutionAlreadyStartedError) {
      console.log(`[Temporal] Workflow ${workflowType} id=${id} already running — idempotent.`);
      return id;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Temporal] Failed to start workflow ${workflowType}: ${msg}`);
    return null;
  }
}

/**
 * Send a signal to a running Temporal workflow.
 */
export async function signalTemporalWorkflow(
  workflowId: string,
  signalName: string,
  payload?: unknown
): Promise<void> {
  const client = await getTemporalClient();
  if (!client) return;

  try {
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal(signalName, payload);
    console.log(`[Temporal] Sent signal ${signalName} to workflow ${workflowId}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Temporal] Failed to signal workflow ${workflowId}: ${msg}`);
  }
}

/**
 * Query a running Temporal workflow.
 */
export async function queryTemporalWorkflow<T>(
  workflowId: string,
  queryName: string,
  args?: unknown[]
): Promise<T | null> {
  const client = await getTemporalClient();
  if (!client) return null;

  try {
    const handle = client.workflow.getHandle(workflowId);
    return await handle.query<T>(queryName, ...((args ?? []) as []));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Temporal] Failed to query workflow ${workflowId}: ${msg}`);
    return null;
  }
}
