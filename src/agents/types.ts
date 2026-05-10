import type { MigrationAuditResult } from "../generated/dsl/handoffs.js";

export type TaskId =
  | "audit-migration-safety"
  | "propose-expand-contract"
  | "explain-command-result";

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
}

export interface AuditOptions {
  dryRun?: boolean;
  failOn?: "warning" | "error" | "critical";
}

export interface AuditRunResult {
  taskId: TaskId;
  data: MigrationAuditResult | null;
  raw: string;
  prompt: string;
  dryRun: boolean;
  status: "success" | "error" | "escalation" | "validation_error";
  errorMessage?: string;
  followUpsUsed: number;
  retriesUsed: number;
}
