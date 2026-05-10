import { describe, it, expect } from "vitest";
import { computeExitCode, formatResultText, formatResultJson } from "../../src/agents/formatter.js";
import type { AuditRunResult } from "../../src/agents/types.js";

function makeResult(overrides: Partial<AuditRunResult> = {}): AuditRunResult {
  return {
    taskId: "audit-migration-safety",
    data: {
      summary: "Migration looks safe",
      riskLevel: "low",
      findings: [],
    },
    raw: "",
    prompt: "test prompt",
    dryRun: false,
    status: "success",
    followUpsUsed: 0,
    retriesUsed: 0,
    ...overrides,
  };
}

describe("computeExitCode", () => {
  it("returns 0 for dry run", () => {
    const result = makeResult({ dryRun: true });
    expect(computeExitCode(result, {})).toBe(0);
  });

  it("returns 1 for non-success status", () => {
    const result = makeResult({ status: "error", data: null });
    expect(computeExitCode(result, {})).toBe(1);
  });

  it("returns 0 when no findings exceed threshold", () => {
    const result = makeResult({
      data: {
        summary: "OK",
        riskLevel: "low",
        findings: [
          { severity: "info", category: "idempotency", message: "Looks good" },
          { severity: "warning", category: "lock_risk", message: "Minor concern" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "error" })).toBe(0);
  });

  it("returns 10 when findings exceed threshold", () => {
    const result = makeResult({
      data: {
        summary: "Issues found",
        riskLevel: "high",
        findings: [
          { severity: "error", category: "expand_contract", message: "Needs E/C" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "error" })).toBe(10);
  });

  it("respects failOn=warning threshold", () => {
    const result = makeResult({
      data: {
        summary: "Minor issues",
        riskLevel: "medium",
        findings: [
          { severity: "warning", category: "lock_risk", message: "Watch out" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "warning" })).toBe(10);
  });

  it("respects failOn=critical threshold", () => {
    const result = makeResult({
      data: {
        summary: "Errors present but not critical",
        riskLevel: "high",
        findings: [
          { severity: "error", category: "expand_contract", message: "Bad" },
        ],
      },
    });
    expect(computeExitCode(result, { failOn: "critical" })).toBe(0);
  });
});

describe("formatResultText", () => {
  it("returns prompt for dry run", () => {
    const result = makeResult({ dryRun: true, prompt: "my prompt" });
    expect(formatResultText(result)).toBe("my prompt");
  });

  it("formats findings with severity icons", () => {
    const result = makeResult({
      data: {
        summary: "Issues found",
        riskLevel: "high",
        findings: [
          {
            severity: "critical",
            category: "lock_risk",
            message: "Long lock",
            recommendation: "Use CONCURRENTLY",
            location: "CREATE INDEX",
          },
        ],
      },
    });
    const text = formatResultText(result);
    expect(text).toContain("Risk Level: HIGH");
    expect(text).toContain("[lock_risk] Long lock");
    expect(text).toContain("Location: CREATE INDEX");
    expect(text).toContain("Recommendation: Use CONCURRENTLY");
  });

  it("shows error message on failure", () => {
    const result = makeResult({ status: "error", data: null, errorMessage: "LLM failed" });
    expect(formatResultText(result)).toBe("LLM failed");
  });
});

describe("formatResultJson", () => {
  it("returns prompt JSON for dry run", () => {
    const result = makeResult({ dryRun: true, prompt: "p" });
    const json = JSON.parse(formatResultJson(result));
    expect(json.dryRun).toBe(true);
    expect(json.prompt).toBe("p");
  });

  it("returns data JSON on success", () => {
    const result = makeResult();
    const json = JSON.parse(formatResultJson(result));
    expect(json.summary).toBe("Migration looks safe");
    expect(json.riskLevel).toBe("low");
  });

  it("returns error JSON on failure", () => {
    const result = makeResult({ status: "error", data: null, errorMessage: "oops" });
    const json = JSON.parse(formatResultJson(result));
    expect(json.error).toBe("oops");
  });
});
