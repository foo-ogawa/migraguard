import { writeFile } from 'node:fs/promises';
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

export interface DepsOptions {
  html?: string;
}

export async function commandDeps(
  config: MigraguardConfig,
  options: DepsOptions = {},
): Promise<DepsResult> {
  const graph = await buildDependencyGraph(config);
  const cycles = detectCycles(graph);
  const ok = cycles.length === 0;

  if (options.html) {
    await generateHtml(graph, cycles, options.html);
    console.log(chalk.green(`✓ HTML written to: ${options.html}`));
  } else {
    printTree(graph, cycles);
  }

  return { ok, graph, cycles };
}

// ---------------------------------------------------------------------------
// Tree rendering (shared by text and HTML)
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

// ---------------------------------------------------------------------------
// Text tree (terminal)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// HTML output (GitGraph.js)
// ---------------------------------------------------------------------------

const BRANCH_COLORS = [
  '#4C9AFF', '#F5A623', '#7B68EE', '#FF6B6B', '#2ECC71',
  '#E67E22', '#9B59B6', '#1ABC9C', '#E74C3C', '#3498DB',
];

function shortName(file: string): string {
  return file.replace(/\.sql$/, '').replace(/^\d{8}_\d{6}__/, '');
}

function findTrunk(node: TreeNode): TreeNode[] {
  if (node.children.length === 0) return [node];
  let best: TreeNode[] = [];
  for (const child of node.children) {
    const path = findTrunk(child);
    if (path.length > best.length) best = path;
  }
  return [node, ...best];
}

async function generateHtml(
  graph: DependencyGraph,
  cycles: CycleError[],
  outputPath: string,
): Promise<void> {
  const trees = buildTree(graph);
  const leaves = new Set(findLeafNodes(graph));
  const js: string[] = [];
  let colorIdx = 0;
  let varIdx = 0;

  function nextColor(): string {
    return BRANCH_COLORS[colorIdx++ % BRANCH_COLORS.length];
  }

  function nextVar(): string {
    return `b${varIdx++}`;
  }

  function commitStyle(file: string): string {
    const isLeaf = leaves.has(file);
    const dot = isLeaf
      ? '{ size: 10, color: "#2ECC71", strokeColor: "#27AE60" }'
      : '{ size: 10 }';
    const msg = isLeaf
      ? '{ color: "#2ECC71", font: "normal 13px ui-monospace, monospace" }'
      : '{ font: "normal 13px ui-monospace, monospace" }';
    return `{ subject: ${JSON.stringify(file)}, style: { dot: ${dot}, message: ${msg} } }`;
  }

  function emitSubtree(root: TreeNode, parentVar: string | null): void {
    const trunk = findTrunk(root);
    const trunkSet = new Set(trunk.map((n) => n.file));

    const branchVar = nextVar();
    const color = nextColor();
    const label = shortName(root.file);

    if (parentVar === null) {
      js.push(`const ${branchVar} = gitgraph.branch({ name: ${JSON.stringify(label)}, style: { color: "${color}", label: { font: "normal 12px ui-monospace, monospace" } } });`);
    } else {
      js.push(`const ${branchVar} = ${parentVar}.branch({ name: ${JSON.stringify(label)}, style: { color: "${color}", label: { font: "normal 12px ui-monospace, monospace" } } });`);
    }

    for (const trunkNode of trunk) {
      js.push(`${branchVar}.commit(${commitStyle(trunkNode.file)});`);

      const forks = trunkNode.children.filter((c) => !trunkSet.has(c.file));
      for (const fork of forks) {
        emitSubtree(fork, branchVar);
      }
    }
  }

  for (const root of trees) {
    emitSubtree(root, null);
  }

  const cycleWarning = cycles.length > 0
    ? `<div style="margin-top:24px;padding:12px 16px;background:#FFF3CD;border-left:4px solid #E74C3C;border-radius:4px;font-family:monospace;font-size:13px;">
        <strong>Circular dependencies detected:</strong><br>
        ${cycles.map((c) => c.cycle.join(' → ')).join('<br>')}
      </div>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>migraguard — Migration Dependency Graph</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    padding: 32px;
    min-height: 100vh;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #fff;
  }
  .meta {
    font-size: 13px;
    color: #888;
    margin-bottom: 24px;
  }
  .meta span { margin-right: 16px; }
  .legend {
    display: flex;
    gap: 20px;
    margin-bottom: 20px;
    font-size: 13px;
    font-family: ui-monospace, monospace;
  }
  .legend-item { display: flex; align-items: center; gap: 6px; }
  .legend-dot {
    width: 10px; height: 10px; border-radius: 50%;
    display: inline-block;
  }
  #graph-container {
    overflow-x: auto;
    padding: 8px 0;
  }
</style>
</head>
<body>
  <h1>migraguard — Migration Dependency Graph</h1>
  <div class="meta">
    <span>${graph.files.length} files</span>
    <span>${graph.edges.length} deps</span>
    <span>${leaves.size} leaves</span>
  </div>
  <div class="legend">
    <div class="legend-item"><span class="legend-dot" style="background:#2ECC71;"></span> editable (leaf)</div>
    <div class="legend-item"><span class="legend-dot" style="background:#4C9AFF;"></span> locked (depended on)</div>
  </div>
  <div id="graph-container"></div>
  ${cycleWarning}
  <script src="https://cdn.jsdelivr.net/npm/@gitgraph/js"></script>
  <script>
  const graphContainer = document.getElementById("graph-container");
  const gitgraph = GitgraphJS.createGitgraph(graphContainer, {
    template: GitgraphJS.templateExtend("metro", {
      colors: ${JSON.stringify(BRANCH_COLORS)},
      branch: {
        lineWidth: 3,
        spacing: 46,
        label: { display: true, font: "normal 12px ui-monospace, monospace" },
      },
      commit: {
        spacing: 52,
        dot: { size: 8 },
        message: { displayAuthor: false, displayHash: false, font: "normal 13px ui-monospace, monospace" },
      },
    }),
    orientation: "vertical",
  });
  ${js.join('\n  ')}
  </script>
</body>
</html>
`;
  await writeFile(outputPath, html, 'utf-8');
}
