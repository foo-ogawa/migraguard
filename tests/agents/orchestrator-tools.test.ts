import { describe, it, expect, vi, beforeEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const calls: Array<{ workflowId: string; options: any }> = [];

vi.mock('agent-contracts-runtime', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  executeWorkflow: vi.fn(async (workflowId: string, options: any) => {
    calls.push({ workflowId, options });
    return { status: 'completed', steps: [{ outcome: { status: 'success', data: {}, raw: '{}' } }] };
  }),
}));

const { runAgentWorkflow } = await import('../../src/agents/orchestrator.js');

describe('runAgentWorkflow adapter options', () => {
  beforeEach(() => { calls.length = 0; });

  it('gives the agent no file-system tools, since the prompt already carries the context', async () => {
    await runAgentWorkflow('context', 'audit-migration-safety', 'migration-audit', { adapter: 'claude' }, {});
    expect(calls).toHaveLength(1);
    expect(calls[0].options.adapterOptions.tools).toEqual([]);
  });
});
