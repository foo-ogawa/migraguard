import chalk from 'chalk';
import { pkg } from '../index.js';
import { loadConfig } from '../config.js';
import { createProgram, type CommandHandlers } from '../generated/program.js';
import { commandNew } from '../commands/new.js';
import { commandCheck } from '../commands/check.js';
import { commandSquash } from '../commands/squash.js';
import { commandLint } from '../commands/lint.js';
import { commandEditable } from '../commands/editable.js';
import { commandApply } from '../commands/apply.js';
import { commandStatus } from '../commands/status.js';
import { commandResolve } from '../commands/resolve.js';
import { commandDump } from '../commands/dump.js';
import { commandDiff } from '../commands/diff.js';
import { commandVerify } from '../commands/verify.js';
import { commandDeps } from '../commands/deps.js';
import { commandGroupStatus } from '../commands/group-status.js';
import { commandAdvance } from '../commands/advance.js';
import { commandApplyPhase } from '../commands/apply-phase.js';
import { commandGate } from '../commands/gate.js';
import { commandBaseline } from '../commands/baseline.js';
import { commandAudit } from '../commands/audit.js';
import { commandProposeExpandContract } from '../commands/propose-expand-contract.js';
import { commandExplain } from '../commands/explain.js';
import { commandImplement } from '../commands/implement.js';
import { commandAuditWorkflow } from '../commands/audit-workflow.js';
import { resolvedDsl } from '../generated/dsl/index.js';
import type { Phase } from '../naming.js';

function asArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

const handlers: CommandHandlers = {
  new: async (name, opts) => run(async () => {
    const config = await loadConfig();
    await commandNew(config, name!, { expandContract: opts.expandContract, dryRun: opts.dryRun });
  }),

  apply: async (opts) => run(async () => {
    const config = await loadConfig();
    const result = await commandApply(config, {
      withDriftCheck: opts.withDriftCheck,
      fromBaseline: opts.fromBaseline,
      tag: opts.tag,
      dryRun: opts.dryRun,
    });
    if (result.errors.length > 0) process.exit(1);
  }),

  check: async () => run(async () => {
    const config = await loadConfig();
    const result = await commandCheck(config);
    if (!result.ok) process.exit(1);
  }),

  squash: async (opts) => run(async () => {
    const config = await loadConfig();
    await commandSquash(config, { dryRun: opts.dryRun });
  }),

  lint: async () => run(async () => {
    const config = await loadConfig();
    const result = await commandLint(config);
    if (!result.ok) process.exit(1);
  }),

  dump: async () => run(async () => {
    const config = await loadConfig();
    await commandDump(config);
  }),

  diff: async () => run(async () => {
    const config = await loadConfig();
    const result = await commandDiff(config);
    if (!result.identical) process.exit(1);
  }),

  status: async () => run(async () => {
    const config = await loadConfig();
    await commandStatus(config);
  }),

  resolve: async (file, opts) => run(async () => {
    const config = await loadConfig();
    await commandResolve(config, file!, { dryRun: opts.dryRun });
  }),

  editable: async () => run(async () => {
    const config = await loadConfig();
    await commandEditable(config);
  }),

  verify: async (opts) => run(async () => {
    const config = await loadConfig();
    const result = await commandVerify(config, { all: opts.all });
    if (result.failed > 0) process.exit(1);
  }),

  groupStatus: async (group) => run(async () => {
    const config = await loadConfig();
    await commandGroupStatus(config, group);
  }),

  baseline: async (opts) => run(async () => {
    const config = await loadConfig();
    const result = await commandBaseline(config, {
      keepSince: asArray(opts.keepSince),
      dryRun: opts.dryRun,
    });
    if (!result.success) process.exit(1);
  }),

  advance: async (group, phase, status, opts) => run(async () => {
    const config = await loadConfig();
    const validPhases = ['expand', 'backfill', 'switch', 'contract'];
    const validStatuses = ['running', 'completed', 'failed'];
    if (!validPhases.includes(phase!)) throw new Error(`Invalid phase: ${phase}`);
    if (!validStatuses.includes(status!)) throw new Error(`Invalid status: ${status}`);
    const result = await commandAdvance(config, {
      group: group!,
      phase: phase as Phase,
      status: status as 'running' | 'completed' | 'failed',
      tag: opts.tag,
      dryRun: opts.dryRun,
    });
    if (!result.success) process.exit(1);
  }),

  applyPhase: async (group, phase, opts) => run(async () => {
    const config = await loadConfig();
    const validPhases = ['expand', 'backfill', 'switch', 'contract'];
    if (!validPhases.includes(phase!)) throw new Error(`Invalid phase: ${phase}`);
    const result = await commandApplyPhase(config, {
      group: group!,
      phase: phase as Phase,
      tag: opts.tag,
      dryRun: opts.dryRun,
    });
    if (!result.success) process.exit(1);
  }),

  gate: async (opts) => run(async () => {
    const config = await loadConfig();
    const result = await commandGate(config, {
      required: asArray(opts.require),
      forbidden: asArray(opts.forbid),
      contractFile: opts.contractFile,
    });
    if (!result.pass) process.exit(1);
  }),

  deps: async (opts) => run(async () => {
    const config = await loadConfig();
    const result = await commandDeps(config, { html: opts.html });
    if (!result.ok) process.exit(1);
  }),

  audit: async (target, opts) => {
    const config = await loadConfig();
    const commandOpts = {
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    };
    if (opts.showPrompt) {
      return commandAudit(config, target, commandOpts);
    }
    await run(async () => {
      await commandAudit(config, target, commandOpts);
    });
  },

  proposeExpandContract: async (file, opts) => {
    const config = await loadConfig();
    const commandOpts = {
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      outputDir: opts.outputDir,
      logFile: opts.logFile,
    };
    if (opts.showPrompt) {
      return commandProposeExpandContract(config, file!, commandOpts);
    }
    await run(async () => {
      await commandProposeExpandContract(config, file!, commandOpts);
    });
  },

  explain: async (opts) => {
    const config = await loadConfig();
    const commandOpts = {
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    };
    if (opts.showPrompt) {
      return commandExplain(config, commandOpts);
    }
    await run(async () => {
      await commandExplain(config, commandOpts);
    });
  },

  implement: async (description, opts) => {
    const config = await loadConfig();
    const commandOpts = {
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      outputDir: opts.outputDir,
      logFile: opts.logFile,
    };
    if (opts.showPrompt) {
      return commandImplement(config, description!, commandOpts);
    }
    await run(async () => {
      await commandImplement(config, description!, commandOpts);
    });
  },

  auditWorkflow: async (opts) => {
    const config = await loadConfig();
    const commandOpts = {
      adapter: opts.adapter,
      model: opts.model,
      showPrompt: opts.showPrompt,
      failOn: opts.failOn as 'warning' | 'error' | 'critical' | undefined,
      output: opts.output,
      reportFormat: opts.reportFormat as 'json' | 'text' | 'yaml' | undefined,
      logFile: opts.logFile,
    };
    if (opts.showPrompt) {
      return commandAuditWorkflow(config, commandOpts);
    }
    await run(async () => {
      await commandAuditWorkflow(config, commandOpts);
    });
  },

  async agents(opts) {
    const YAML = await import('yaml');
    const format = opts.format ?? 'yaml';
    try {
      if (format === 'json') {
        console.log(JSON.stringify(resolvedDsl, null, 2));
      } else {
        console.log(YAML.stringify(resolvedDsl, { lineWidth: 120 }));
      }
    } catch (err) {
      console.error(`Failed to output DSL: ${(err as Error).message}`);
      process.exit(1);
    }
  },
};

createProgram(handlers, pkg.version).parse();
