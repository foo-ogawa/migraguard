import type {
  MigrationAuditResult,
  ExpandContractProposalResult,
  ImplementMigrationResult,
  WorkflowAuditResult,
  ExplainResult,
} from "../generated/dsl/handoffs.js";

export type TaskId =
  | "audit-migration-safety"
  | "propose-expand-contract"
  | "explain-command-result"
  | "implement-migration"
  | "audit-workflow-compliance";

export type WorkflowId =
  | "migration-audit"
  | "expand-contract-proposal"
  | "command-explanation"
  | "migration-implementation"
  | "workflow-audit";

export type AuditResultData =
  | MigrationAuditResult
  | ExpandContractProposalResult
  | ImplementMigrationResult
  | WorkflowAuditResult
  | ExplainResult;

export interface AuditConfig {
  adapter?: string;
  model?: string;
  temperature?: number;
  cwd?: string;
}

export interface AuditOptions {
  failOn?: "warning" | "error" | "critical";
  dryRun?: boolean;
}

export interface AuditRunResult {
  taskId: TaskId;
  data: AuditResultData | null;
  raw: string;
  prompt: string;
  dryRun: boolean;
  status: "success" | "error" | "escalation" | "validation_error";
  errorMessage?: string;
  followUpsUsed: number;
  retriesUsed: number;
}
