import { writeFile } from "node:fs/promises";
import type { AuditRunResult, AuditOptions } from "./types.js";

export type ReportFormat = "json" | "text" | "yaml";

export function computeExitCode(result: AuditRunResult, options: AuditOptions): number {
  if (result.dryRun) return 0;
  if (result.status !== "success" || !result.data) return 1;

  const failOn = options.failOn ?? "error";
  const severityOrder = ["info", "warning", "error", "critical"] as const;
  const threshold = severityOrder.indexOf(failOn);

  const findings = result.data.findings ?? [];
  const hasBlocking = findings.some(
    (f) => severityOrder.indexOf(f.severity) >= threshold,
  );

  return hasBlocking ? 10 : 0;
}

export function formatResultText(result: AuditRunResult): string {
  if (result.status !== "success" || !result.data) {
    return result.errorMessage ?? `Task failed with status: ${result.status}`;
  }

  const data = result.data;
  const lines: string[] = [];

  lines.push(`Risk Level: ${data.riskLevel.toUpperCase()}`);
  lines.push(`Summary: ${data.summary}`);
  lines.push("");

  const findings = data.findings ?? [];
  if (findings.length > 0) {
    lines.push(`Findings (${findings.length}):`);
    lines.push("");

    for (const finding of findings) {
      const prefix = severityIcon(finding.severity);
      lines.push(`  ${prefix} [${finding.category}] ${finding.message}`);
      if ("location" in finding && finding.location) {
        lines.push(`    Location: ${finding.location}`);
      }
      if ("recommendation" in finding && finding.recommendation) {
        lines.push(`    Recommendation: ${finding.recommendation}`);
      }
      lines.push("");
    }
  }

  if (data.recommendedActions && data.recommendedActions.length > 0) {
    lines.push("Recommended Actions:");
    for (const action of data.recommendedActions) {
      lines.push(`  - [${action.kind}] ${action.title}`);
      if ("command" in action && action.command) {
        lines.push(`    $ ${action.command}`);
      }
    }
  }

  return lines.join("\n");
}

export function formatResultJson(result: AuditRunResult): string {
  if (!result.data) {
    return JSON.stringify({ error: result.errorMessage, status: result.status }, null, 2);
  }
  return JSON.stringify(result.data, null, 2);
}

export function formatResultYaml(result: AuditRunResult): string {
  if (!result.data) {
    return `error: ${JSON.stringify(result.errorMessage)}\nstatus: ${result.status}`;
  }
  return toSimpleYaml(result.data);
}

export function formatResult(result: AuditRunResult, format: ReportFormat): string {
  switch (format) {
    case "json": return formatResultJson(result);
    case "yaml": return formatResultYaml(result);
    case "text": return formatResultText(result);
  }
}

export async function writeOutput(content: string, outputPath?: string): Promise<void> {
  if (outputPath) {
    await writeFile(outputPath, content + "\n", "utf-8");
  } else {
    process.stdout.write(content + "\n");
  }
}

function severityIcon(severity: "info" | "warning" | "error" | "critical"): string {
  switch (severity) {
    case "critical": return "\u2716";
    case "error": return "\u2716";
    case "warning": return "\u26A0";
    case "info": return "\u2139";
  }
}

function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);
  return text.split("\n").map((l) => pad + l).join("\n");
}

function toSimpleYaml(obj: unknown, depth = 0): string {
  const pad = "  ".repeat(depth);
  if (obj === null || obj === undefined) return `${pad}null`;
  if (typeof obj === "string") {
    if (obj.includes("\n")) return `|\n${indent(obj, (depth + 1) * 2)}`;
    return JSON.stringify(obj);
  }
  if (typeof obj === "number" || typeof obj === "boolean") return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return "[]";
    return obj.map((item) => {
      const val = toSimpleYaml(item, depth + 1);
      if (typeof item === "object" && item !== null) {
        return `${pad}- ${val.trimStart()}`;
      }
      return `${pad}- ${val}`;
    }).join("\n");
  }
  if (typeof obj === "object") {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    return entries.map(([k, v]) => {
      const val = toSimpleYaml(v, depth + 1);
      if (typeof v === "object" && v !== null && !Array.isArray(v)) {
        return `${pad}${k}:\n${val}`;
      }
      if (Array.isArray(v) && v.length > 0) {
        return `${pad}${k}:\n${val}`;
      }
      return `${pad}${k}: ${val}`;
    }).join("\n");
  }
  return String(obj);
}
