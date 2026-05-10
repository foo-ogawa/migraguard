import type { AuditConfig, AuditOptions, AuditRunResult, TaskId } from "./types.js";

export const EXIT_RUNTIME_MISSING = 11;
export const EXIT_ADAPTER_ERROR = 12;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createAdapter(runtimePkg: string, name: string, config: AuditConfig): Promise<any> {
  switch (name) {
    case "mock": {
      const mod = await import(`${runtimePkg}/adapters/mock`);
      return new mod.MockAdapter();
    }
    case "cursor": {
      const mod = await import(`${runtimePkg}/adapters/cursor-sdk`);
      const apiKey = process.env.CURSOR_API_KEY;
      if (!apiKey) {
        throw new Error(
          "CURSOR_API_KEY environment variable is required for the cursor adapter.\n" +
          "Get your key from: https://cursor.com/dashboard/integrations",
        );
      }
      return mod.CursorSdkAdapter.create({ apiKey, model: config.model ?? "claude-opus-4-6" });
    }
    case "claude": {
      const mod = await import(`${runtimePkg}/adapters/claude-agent-sdk`);
      return new mod.ClaudeAgentSdkAdapter({
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
      const mod = await import(`${runtimePkg}/adapters/gemini-sdk`);
      return new mod.GeminiSdkAdapter({
        apiKey: process.env.GEMINI_API_KEY,
        model: config.model ?? "gemini-2.5-pro",
        temperature: config.temperature,
      });
    }
    default:
      throw new Error(
        `Unsupported adapter: "${name}". ` +
        "Available: mock, cursor, claude, openai, gemini.",
      );
  }
}

export async function runAgentTask(
  userRequest: string,
  taskId: TaskId,
  auditConfig: AuditConfig,
  options: AuditOptions,
): Promise<AuditRunResult> {
  if (options.dryRun) {
    return {
      taskId,
      data: null,
      raw: "",
      prompt: userRequest,
      dryRun: true,
      status: "success",
      followUpsUsed: 0,
      retriesUsed: 0,
    };
  }

  const RUNTIME_PKG = ["agent-contracts", "runtime"].join("-");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let runTask: (...args: any[]) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let agentRegistry: any, taskRegistry: any, handoffSchemas: any;

  try {
    const runtime = await import(RUNTIME_PKG);
    runTask = runtime.runTask;
  } catch {
    throw Object.assign(
      new Error(
        "agent-contracts-runtime is not installed. " +
        "Install it to use this command, or use --dry-run to inspect the prompt.\n" +
        "  npm install agent-contracts-runtime",
      ),
      { exitCode: EXIT_RUNTIME_MISSING },
    );
  }

  try {
    const dsl = await import("../generated/dsl/index.js");
    agentRegistry = dsl.agentRegistry;
    taskRegistry = dsl.taskRegistry;
    handoffSchemas = dsl.handoffSchemas;
  } catch {
    agentRegistry = {};
    taskRegistry = {};
    handoffSchemas = {};
  }

  const adapterName = auditConfig.adapter ?? "mock";
  let adapter;
  try {
    adapter = await createAdapter(RUNTIME_PKG, adapterName, auditConfig);
  } catch (err) {
    throw Object.assign(err as Error, { exitCode: EXIT_ADAPTER_ERROR });
  }

  const result = await runTask(adapter, taskId, {
    user_request: userRequest,
  }, {
    maxFollowUps: 3,
    maxRetries: 1,
    agentRegistry,
    taskRegistry,
    handoffSchemas,
  });

  const outcome = result.outcome;
  return {
    taskId,
    data: outcome.status === "success" ? outcome.data : null,
    raw: (outcome.raw as string) ?? "",
    prompt: userRequest,
    dryRun: false,
    status: outcome.status as AuditRunResult["status"],
    errorMessage:
      outcome.status === "error" ? outcome.message :
      outcome.status === "escalation" ? outcome.reason :
      outcome.status === "validation_error" ? outcome.errors?.message :
      undefined,
    followUpsUsed: result.follow_ups_used,
    retriesUsed: result.retries_used,
  };
}
