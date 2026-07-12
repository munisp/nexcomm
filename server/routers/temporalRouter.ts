/**
 * NEXCOM Exchange — Temporal Workflow tRPC Router
 *
 * Provides tRPC procedures to trigger, query, cancel, and list
 * Temporal workflows from the web/mobile frontend.
 *
 * Supported workflows (from WORKFLOW_REGISTRY):
 *   - MarginCallWorkflow
 *   - KycReviewWorkflow
 *   - SettlementWorkflow
 *   - LoanDisbursementWorkflow
 *   - CrossBorderFxWorkflow
 *
 * Procedures:
 *   trigger       — start a named workflow (admin only)
 *   getStatus     — query workflow status by workflowId
 *   cancel        — signal a running workflow to abort
 *   listWorkflows — list recent workflow runs (admin only)
 *   getRegistry   — return the WORKFLOW_REGISTRY metadata (public)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure, publicProcedure } from "../_core/trpc";
import { writeAuditLog } from "../audit";
import {
  triggerTemporalWorkflow,
  signalTemporalWorkflow,
  queryTemporalWorkflow,
} from "../temporal/temporalClient";
import { WORKFLOW_REGISTRY, type WorkflowName } from "../temporal/workflows";

// ── Input schemas ─────────────────────────────────────────────────────────────

const TriggerInput = z.object({
  workflowName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).default({}),
  workflowId: z.string().min(1).optional(),
});

const StatusInput = z.object({
  workflowId: z.string().min(1),
  queryName: z.string().default("getStatus"),
});

const CancelInput = z.object({
  workflowId: z.string().min(1),
  reason: z.string().max(256).optional(),
});

// ── Router ────────────────────────────────────────────────────────────────────

export const temporalRouter = router({
  /**
   * Return the WORKFLOW_REGISTRY metadata so the UI can enumerate workflows.
   */
  getRegistry: publicProcedure.query(() => {
    return Object.entries(WORKFLOW_REGISTRY).map(([, wf]) => ({
      name: wf.name,
      description: (wf as Record<string, unknown>).description as string ?? null,
      taskQueue: wf.taskQueue,
    }));
  }),

  /**
   * Admin: trigger a named Temporal workflow.
   */
  trigger: adminProcedure.input(TriggerInput).mutation(async ({ ctx, input }) => {
    const wfName = input.workflowName as WorkflowName;
    if (!(wfName in WORKFLOW_REGISTRY)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Unknown workflow: ${input.workflowName}. Valid: ${Object.keys(WORKFLOW_REGISTRY).join(", ")}`,
      });
    }

    const workflowId =
      input.workflowId ?? `${wfName.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    await triggerTemporalWorkflow(wfName, input.payload, workflowId);

    await writeAuditLog({
      userId: ctx.user.id,
      action: "temporal.trigger",
      details: { workflowName: wfName, workflowId, payload: input.payload },
    });

    return { workflowId, workflowName: wfName, status: "STARTED" as const };
  }),

  /**
   * Query the status of any Temporal workflow by workflowId.
   */
  getStatus: protectedProcedure.input(StatusInput).query(async ({ input }) => {
    const result = await queryTemporalWorkflow<unknown>(
      input.workflowId,
      input.queryName
    );

    return {
      workflowId: input.workflowId,
      queryName: input.queryName,
      result: result ?? null,
      available: result !== null,
    };
  }),

  /**
   * Signal a running Temporal workflow to cancel.
   */
  cancel: protectedProcedure.input(CancelInput).mutation(async ({ ctx, input }) => {
    await signalTemporalWorkflow(
      input.workflowId,
      "cancel",
      { reason: input.reason ?? "User requested cancellation" }
    );

    await writeAuditLog({
      userId: ctx.user.id,
      action: "temporal.cancel",
      details: { workflowId: input.workflowId, reason: input.reason },
    });

    return { success: true, workflowId: input.workflowId };
  }),

  /**
   * Admin: list recent workflow runs (metadata only — no Temporal SDK list API in this env).
   * Returns a synthetic list of known workflow IDs from audit logs.
   */
  listWorkflows: adminProcedure
    .input(
      z.object({
        workflowName: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      // In production, this would call Temporal's list workflow executions API.
      // For now, return the registry with placeholder run counts.
      const registry = Object.entries(WORKFLOW_REGISTRY).map(([, wf]) => ({
        workflowName: wf.name,
        taskQueue: wf.taskQueue,
        description: ((wf as Record<string, unknown>).description as string) ?? null,
        recentRuns: [] as { workflowId: string; status: string; startedAt: string }[],
      }));

      if (input.workflowName) {
        return registry.filter((r) => r.workflowName === input.workflowName);
      }
      return registry.slice(0, input.limit);
    }),
});
