import { resolve } from "node:path";
import { resolvedDsl } from "../generated/dsl/dsl-data.js";
import { handoffs } from "../generated/dsl/handoffs.js";
import type { AuditConfig, AuditOptions, AuditRunResult, TaskId, WorkflowId } from "./types.js";

export const EXIT_RUNTIME_MISSING = 11;
export const EXIT_ADAPTER_ERROR = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createAdapter(runtimePkg: string, name: string, config: AuditConfig): Promise<any> {
  const cwd = config.cwd ?? process.cwd();
  switch (name) {
    case "mock": {
      const mod = await import(`${runtimePkg}/adapters/mock`);
      return new mod.MockAdapter();
    }
    case "claude": {
      const mod = await import(`${runtimePkg}/adapters/claude-agent-sdk`);
      return new mod.ClaudeAgentSdkAdapter({
        cwd,
        model: config.model,
        tools: ["Read", "Glob", "Grep"],
        permissionMode: "bypassPermissions",
      });
    }
    case "openai": {
      const mod = await import(`${runtimePkg}/adapters/openai-agents-sdk`);
      return new mod.OpenAIAgentsSdkAdapter({
        model: config.model ?? "o3-mini",
        maxTurns: 1,
      });
    }
    case "gemini": {
      const mod = await import(`${runtimePkg}/adapters/adk-sdk`);
      return new mod.AdkSdkAdapter({
        apiKey: process.env.GEMINI_API_KEY,
        model: config.model ?? "gemini-2.5-pro",
        temperature: config.temperature,
      });
    }
    default:
      throw new Error(
        `Unsupported adapter: "${name}". ` +
        "Available: mock, claude, openai, gemini.",
      );
  }
}

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
 * for the invocation_handoff schema, passes it alongside registries to runWorkflow(),
 * and maps the WorkflowResult back to AuditRunResult.
 *
 * Never calls adapter.send() or runTask() directly (R-IMPL-002).
 * Uses runWorkflow() from agent-contracts-runtime exclusively.
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

  // Single string variable for graceful degradation (R-IMPL-006).
  const RUNTIME_PKG = ["agent-contracts", "runtime"].join("-");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runWorkflow: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadDslContext: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createProgressSink: (...args: any[]) => { write: (chunk: string) => void; close: () => void };
  try {
    const runtime = await import(RUNTIME_PKG);
    runWorkflow = runtime.runWorkflow;
    loadDslContext = runtime.loadDslContext;
    createProgressSink = runtime.createProgressSink;
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

  let ctx;
  try {
    ctx = await loadDslContext({
      embeddedDsl: resolvedDsl,
      requiredEntities: {
        workflows: [
          "migration-audit",
          "expand-contract-proposal",
          "migration-implementation",
          "workflow-audit",
          "command-explanation",
        ],
      },
    });
  } catch (err) {
    throw Object.assign(
      new Error(
        "Failed to load DSL context. " +
        "Run `npm run dsl:generate` to regenerate.\n" +
        `  ${(err as Error).message}`,
      ),
      { exitCode: EXIT_RUNTIME_MISSING },
    );
  }

  // Initialise adapter (R-IMPL-001).
  const adapterName = auditConfig.adapter ?? "mock";
  let adapter;
  try {
    adapter = await createAdapter(RUNTIME_PKG, adapterName, auditConfig);
  } catch (err) {
    throw Object.assign(err as Error, { exitCode: EXIT_ADAPTER_ERROR });
  }

  const progressSink = options.logFile
    ? createProgressSink({ stderr: true, file: resolve(options.logFile), naming: "single" })
    : createProgressSink({ stderr: true });

  // Build structured handoff envelope for runtime validation against
  // the invocation_handoff schema defined in the DSL task contract.
  const handoff = handoffs.migrationAuditRequest({
    task_id: taskId,
    context: userRequest,
  });

  try {
    const workflowResult = await runWorkflow(
      adapter,
      {
        workflow: workflowId,
        handoff,
        user_request: userRequest,
        progressOutput: progressSink,
        runtime: {
          maxFollowUps: 3,
          maxRetries: 1,
        },
        context: {
          cwd: auditConfig.cwd ?? process.cwd(),
        },
      },
      ctx.registries,
    );

    return mapWorkflowResult(taskId, userRequest, workflowResult);
  } finally {
    progressSink.close();
  }
}
