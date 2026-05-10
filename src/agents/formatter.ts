import type { MigrationAuditResult } from "../generated/dsl/handoffs.js";
import type { AuditRunResult, AuditOptions } from "./types.js";

export function computeExitCode(result: AuditRunResult, options: AuditOptions): number {
  if (result.dryRun) return 0;
  if (result.status !== "success" || !result.data) return 1;

  const failOn = options.failOn ?? "error";
  const severityOrder = ["info", "warning", "error", "critical"] as const;
  const threshold = severityOrder.indexOf(failOn);

  const hasBlocking = result.data.findings.some(
    (f) => severityOrder.indexOf(f.severity) >= threshold,
  );

  return hasBlocking ? 10 : 0;
}

export function formatResultText(result: AuditRunResult): string {
  if (result.dryRun) {
    return result.prompt;
  }

  if (result.status !== "success" || !result.data) {
    return result.errorMessage ?? `Task failed with status: ${result.status}`;
  }

  const data = result.data;
  const lines: string[] = [];

  lines.push(`Risk Level: ${data.riskLevel.toUpperCase()}`);
  lines.push(`Summary: ${data.summary}`);
  lines.push("");

  if (data.findings.length > 0) {
    lines.push(`Findings (${data.findings.length}):`);
    lines.push("");

    for (const finding of data.findings) {
      const prefix = severityIcon(finding.severity);
      lines.push(`  ${prefix} [${finding.category}] ${finding.message}`);
      if (finding.location) {
        lines.push(`    Location: ${finding.location}`);
      }
      if (finding.recommendation) {
        lines.push(`    Recommendation: ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  if (data.recommendedActions && data.recommendedActions.length > 0) {
    lines.push("Recommended Actions:");
    for (const action of data.recommendedActions) {
      lines.push(`  - [${action.kind}] ${action.title}`);
      if (action.command) {
        lines.push(`    $ ${action.command}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatResultJson(result: AuditRunResult): string {
  if (result.dryRun) {
    return JSON.stringify({ dryRun: true, prompt: result.prompt }, null, 2);
  }
  if (!result.data) {
    return JSON.stringify({ error: result.errorMessage, status: result.status }, null, 2);
  }
  return JSON.stringify(result.data, null, 2);
}

function severityIcon(severity: MigrationAuditResult["findings"][number]["severity"]): string {
  switch (severity) {
    case "critical": return "✖";
    case "error": return "✖";
    case "warning": return "⚠";
    case "info": return "ℹ";
  }
}
