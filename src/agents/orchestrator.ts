import { resolvedDsl } from "../generated/dsl/dsl-data.js";
import { handoffs } from "../generated/dsl/handoffs.js";
import type { AuditConfig, AuditOptions, AuditRunResult, TaskId, WorkflowId } from "./types.js";

export const EXIT_RUNTIME_MISSING = 11;
export const EXIT_ADAPTER_ERROR = 12;

/**
 * Map a WorkflowResult (with its first delegate-step outcome) to AuditRunResult.
 * Each migraguard workflow has exactly one delegate step, so we extract steps[0].
 */
function mapWorkflowResult(
  taskId: TaskId,
  userRequest: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workflowResult: any,
): AuditRunResult {
  const wfStatus = workflowResult.status as string;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firstStep = (workflowResult.steps?.[0] ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const outcome = (firstStep.outcome ?? {}) as any;

  const followUpsUsed = Number(firstStep.follow_ups_used ?? workflowResult.follow_ups_used ?? 0);
  const retriesUsed = Number(firstStep.retries_used ?? workflowResult.retries_used ?? 0);

  if (wfStatus === "completed" && outcome.status === "success") {
    return {
      taskId,
      data: outcome.data ?? null,
      raw: String(outcome.raw ?? ""),
      prompt: userRequest,
      showPrompt: false,
      status: "success",
      followUpsUsed,
      retriesUsed,
    };
  }

  if (outcome.status === "validation_error") {
    return {
      taskId,
      data: null,
      raw: String(outcome.raw ?? ""),
      prompt: userRequest,
      showPrompt: false,
      status: "validation_error",
      errorMessage: outcome.errors?.message ?? "Schema validation failed",
      followUpsUsed,
      retriesUsed,
    };
  }

  if (wfStatus === "escalated" || outcome.status === "escalation") {
    return {
      taskId,
      data: null,
      raw: String(outcome.raw ?? ""),
      prompt: userRequest,
      showPrompt: false,
      status: "escalation",
      errorMessage: workflowResult.escalation_reason ?? outcome.reason ?? "Agent escalated",
      followUpsUsed,
      retriesUsed,
    };
  }

  return {
    taskId,
    data: null,
    raw: String(outcome.raw ?? ""),
    prompt: userRequest,
    showPrompt: false,
    status: "error",
    errorMessage: workflowResult.error_message ?? outcome.message ?? "Workflow execution failed",
    followUpsUsed,
    retriesUsed,
  };
}

/**
 * Run an LLM task via its enclosing workflow. workflowId must match the command's
 * dsl_workflow in cli-contract.yaml. The function builds a structured HandoffEnvelope
 * for the invocation_handoff schema, passes it alongside registries to executeWorkflow(),
 * and maps the WorkflowResult back to AuditRunResult.
 *
 * Never calls adapter.send() or runTask() directly (R-IMPL-002).
 * Uses executeWorkflow() from agent-contracts-runtime exclusively.
 */
export async function runAgentWorkflow(
  userRequest: string,
  taskId: TaskId,
  workflowId: WorkflowId,
  auditConfig: AuditConfig,
  options: AuditOptions,
): Promise<AuditRunResult> {
  if (options.showPrompt) {
    return {
      taskId,
      data: null,
      raw: "",
      prompt: userRequest,
      showPrompt: true,
      status: "success",
      followUpsUsed: 0,
      retriesUsed: 0,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let executeWorkflow: (workflowId: string, options: any) => Promise<any>;
  try {
    const runtime = await import("agent-contracts-runtime");
    executeWorkflow = runtime.executeWorkflow;
  } catch {
    throw Object.assign(
      new Error(
        "agent-contracts-runtime is not installed. " +
        "Install it to use this command, or use --show-prompt to inspect the prompt.\n" +
        "  npm install agent-contracts-runtime",
      ),
      { exitCode: EXIT_RUNTIME_MISSING },
    );
  }

  const adapterName = auditConfig.adapter ?? "mock";

  const handoff = handoffs.migrationAuditRequest({
    task_id: taskId,
    context: userRequest,
  });

  let workflowResult;
  try {
    workflowResult = await executeWorkflow(workflowId, {
      adapter: adapterName,
      model: auditConfig.model,
      dsl: resolvedDsl,
      logFile: options.logFile,
      handoff,
      request: userRequest,
      maxFollowUps: 3,
      maxRetries: 1,
      adapterOptions: {
        cwd: auditConfig.cwd ?? process.cwd(),
        tools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
      },
      context: {
        cwd: auditConfig.cwd ?? process.cwd(),
      },
    });
  } catch (err) {
    throw Object.assign(err as Error, { exitCode: EXIT_ADAPTER_ERROR });
  }

  return mapWorkflowResult(taskId, userRequest, workflowResult);
}
