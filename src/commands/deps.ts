import chalk from 'chalk';
import type { MigraguardConfig } from '../config.js';
import {
  buildDependencyGraph,
  detectCycles,
  findLeafNodes,
} from '../deps.js';
import type { DependencyGraph, CycleError } from '../deps.js';

export interface DepsResult {
  ok: boolean;
  graph: DependencyGraph;
  cycles: CycleError[];
}

export async function commandDeps(
  config: MigraguardConfig,
): Promise<DepsResult> {
  const graph = await buildDependencyGraph(config);
  const cycles = detectCycles(graph);
  const ok = cycles.length === 0;

  printTree(graph, cycles);

  return { ok, graph, cycles };
}

// ---------------------------------------------------------------------------
// Tree rendering
// ---------------------------------------------------------------------------

interface TreeNode {
  file: string;
  children: TreeNode[];
}

function buildTree(graph: DependencyGraph): TreeNode[] {
  const depsByFile = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!depsByFile.has(edge.from)) depsByFile.set(edge.from, []);
    depsByFile.get(edge.from)!.push(edge.to);
  }

  const depth = computeDepths(graph);

  const primaryParent = new Map<string, string>();
  for (const file of graph.files) {
    const parents = depsByFile.get(file);
    if (!parents || parents.length === 0) continue;

    let best = parents[0];
    let bestDepth = depth.get(best) ?? 0;
    for (let i = 1; i < parents.length; i++) {
      const d = depth.get(parents[i]) ?? 0;
      if (d > bestDepth || (d === bestDepth && parents[i] < best)) {
        best = parents[i];
        bestDepth = d;
      }
    }
    primaryParent.set(file, best);
  }

  const childrenOf = new Map<string, string[]>();
  for (const file of graph.files) {
    childrenOf.set(file, []);
  }
  for (const [child, parent] of primaryParent) {
    childrenOf.get(parent)?.push(child);
  }
  for (const [, children] of childrenOf) {
    children.sort();
  }

  const roots = graph.files.filter((f) => !primaryParent.has(f));
  roots.sort();

  function build(file: string): TreeNode {
    const children = (childrenOf.get(file) ?? []).map(build);
    return { file, children };
  }

  return roots.map(build);
}

function computeDepths(graph: DependencyGraph): Map<string, number> {
  const depsByFile = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!depsByFile.has(edge.from)) depsByFile.set(edge.from, []);
    depsByFile.get(edge.from)!.push(edge.to);
  }

  const depth = new Map<string, number>();

  function getDepth(file: string, visited: Set<string>): number {
    if (depth.has(file)) return depth.get(file)!;
    if (visited.has(file)) return 0;
    visited.add(file);

    const parents = depsByFile.get(file);
    if (!parents || parents.length === 0) {
      depth.set(file, 0);
      return 0;
    }

    let maxParent = 0;
    for (const p of parents) {
      maxParent = Math.max(maxParent, getDepth(p, visited));
    }
    const d = maxParent + 1;
    depth.set(file, d);
    return d;
  }

  for (const file of graph.files) {
    getDepth(file, new Set());
  }

  return depth;
}

function printTree(graph: DependencyGraph, cycles: CycleError[]): void {
  if (graph.files.length === 0) {
    console.log(chalk.yellow('No migration files found.'));
    return;
  }

  const trees = buildTree(graph);
  const leaves = new Set(findLeafNodes(graph));
  const lines: string[] = [];

  function render(node: TreeNode, prefix: string, connector: string): void {
    const isLeaf = leaves.has(node.file);
    const mark = isLeaf ? chalk.green('◆') : chalk.gray('◇');
    const label = isLeaf ? chalk.green(node.file) : chalk.cyan(node.file);
    lines.push(prefix + connector + mark + ' ' + label);

    const childPrefix = connector === ''
      ? ''
      : prefix + (connector.startsWith('└') ? '    ' : '│   ');

    for (let i = 0; i < node.children.length; i++) {
      const isLast = i === node.children.length - 1;
      render(node.children[i], childPrefix, isLast ? '└── ' : '├── ');
    }
  }

  for (let i = 0; i < trees.length; i++) {
    if (i > 0) lines.push('');
    render(trees[i], '', '');
  }

  for (const line of lines) {
    console.log(line);
  }

  if (cycles.length > 0) {
    console.log('');
    console.error(chalk.red.bold('Circular dependencies detected:'));
    for (const c of cycles) {
      console.error(chalk.red(`  ${c.cycle.join(' → ')}`));
    }
  }

  console.log('');
  console.log(chalk.green('◆') + chalk.gray(' = editable   ') + chalk.gray('◇ = locked'));
  console.log(chalk.gray(
    `${graph.files.length} files, ${graph.edges.length} deps, ${leaves.size} leaves`,
  ));
}
