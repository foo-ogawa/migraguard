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
  failOn?: "warning" | "error" | "critical";
}

export interface AuditRunResult {
  taskId: TaskId;
  data: MigrationAuditResult | null;
  raw: string;
  prompt: string;
  status: "success" | "error" | "escalation" | "validation_error";
  errorMessage?: string;
  followUpsUsed: number;
  retriesUsed: number;
}
