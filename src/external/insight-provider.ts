import { relative, resolve } from 'node:path';
import type {
  AnchorMapping,
  ExternalEdge,
  ExternalInsight,
  InsightProvider,
  InsightQuery,
} from 'agent-contracts-analyzer';
import { loadConfig } from '../config.js';
import { VERSION as PACKAGE_VERSION } from '../version.js';
import {
  buildDependencyGraphFromFiles,
  detectCycles,
} from '../deps.js';
import type { CycleError, DependencyEdge, DependencyGraph, FileDeps } from '../deps.js';
import { scanMigrations } from '../scanner.js';
import type { MigrationFile } from '../scanner.js';
import { PHASE_ORDER } from '../naming.js';
import type { Phase } from '../naming.js';

export const INSIGHT_PROVIDER_NAME = 'migraguard';

export interface BuildExternalInsightOptions {
  projectRoot: string;
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function toRelativeProjectPath(projectRoot: string, absolutePath: string): string {
  return toPosixPath(relative(resolve(projectRoot), absolutePath));
}

function edgeKey(edge: DependencyEdge): string {
  return `${edge.from}->${edge.to}`;
}

function collectCycleEdgeKeys(cycles: CycleError[]): Set<string> {
  const keys = new Set<string>();
  for (const { cycle } of cycles) {
    for (let i = 0; i < cycle.length - 1; i++) {
      keys.add(`${cycle[i]}->${cycle[i + 1]}`);
    }
  }
  return keys;
}

function deriveKind(via: string): string {
  if (via === '(config)') return 'config_dependency';
  if (via === '(explicit)' || via.startsWith('(explicit:')) return 'explicit_dependency';
  return 'schema_object_dependency';
}

function deriveWeight(kind: string): number {
  return kind === 'schema_object_dependency' ? 0.9 : 1.0;
}

function deriveObjectType(
  edge: DependencyEdge,
  fileDeps: Map<string, FileDeps>,
): string | undefined {
  if (edge.via === '(config)' || edge.via.startsWith('(explicit')) {
    return undefined;
  }
  const deps = fileDeps.get(edge.from);
  if (!deps) return undefined;
  const ref = deps.references.find((r) => r.name === edge.via);
  if (ref) return ref.type;
  const created = deps.creates.find((c) => c.name === edge.via);
  if (created) return created.type;
  return undefined;
}

function dependencyEdgeToExternalEdge(
  edge: DependencyEdge,
  fileDeps: Map<string, FileDeps>,
): ExternalEdge {
  const kind = deriveKind(edge.via);
  const objectType = deriveObjectType(edge, fileDeps);
  const metadata: Record<string, unknown> = { via: edge.via };
  if (objectType) {
    metadata.objectType = objectType;
  }
  return {
    from: edge.from,
    to: edge.to,
    kind,
    propagation: 'backward',
    weight: deriveWeight(kind),
    metadata,
  };
}

function sortGroupFiles(files: MigrationFile[]): MigrationFile[] {
  return [...files].sort((a, b) => {
    const phaseA = a.phase ?? 'expand';
    const phaseB = b.phase ?? 'expand';
    const orderDiff = PHASE_ORDER[phaseA as Phase] - PHASE_ORDER[phaseB as Phase];
    if (orderDiff !== 0) return orderDiff;
    return a.fileName.localeCompare(b.fileName);
  });
}

export function buildAnchorMappings(
  files: MigrationFile[],
  projectRoot: string,
): AnchorMapping[] {
  const byDomainId = new Map<string, Set<string>>();
  const groupMembers = new Map<string, MigrationFile[]>();

  for (const file of files) {
    const relPath = toRelativeProjectPath(projectRoot, file.filePath);
    const paths = byDomainId.get(file.fileName) ?? new Set<string>();
    paths.add(relPath);
    byDomainId.set(file.fileName, paths);

    if (file.groupName) {
      const members = groupMembers.get(file.groupName) ?? [];
      members.push(file);
      groupMembers.set(file.groupName, members);
    }
  }

  for (const [groupName, members] of groupMembers) {
    const paths = byDomainId.get(groupName) ?? new Set<string>();
    for (const file of sortGroupFiles(members)) {
      paths.add(toRelativeProjectPath(projectRoot, file.filePath));
    }
    byDomainId.set(groupName, paths);
  }

  return [...byDomainId.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domainId, pathSet]) => ({
      domainId,
      filePaths: [...pathSet].sort(),
    }));
}

export function buildExternalInsightFromGraph(
  graph: DependencyGraph,
  files: MigrationFile[],
  projectRoot: string,
  cycles: CycleError[] = [],
): ExternalInsight {
  const cycleEdgeKeys = collectCycleEdgeKeys(cycles);
  const edges = graph.edges
    .filter((edge) => !cycleEdgeKeys.has(edgeKey(edge)))
    .map((edge) => dependencyEdgeToExternalEdge(edge, graph.fileDeps));

  const anchorMapping = buildAnchorMappings(files, projectRoot);

  if (cycles.length > 0) {
    anchorMapping.push({
      domainId: '_migraguard:warnings',
      filePaths: [toRelativeProjectPath(projectRoot, projectRoot) || '.'],
      artifactId: JSON.stringify({
        cycleWarnings: cycles.map((c) => c.cycle),
      }),
    });
  }

  return {
    source: INSIGHT_PROVIDER_NAME,
    sourceVersion: PACKAGE_VERSION,
    generatedAt: new Date().toISOString(),
    edges,
    anchorMapping,
  };
}

export async function buildExternalInsight(
  options: BuildExternalInsightOptions,
): Promise<ExternalInsight> {
  const projectRoot = resolve(options.projectRoot);
  const config = await loadConfig(projectRoot);
  const files = await scanMigrations(config);
  const graph = await buildDependencyGraphFromFiles(files, config);
  const cycles = detectCycles(graph);
  return buildExternalInsightFromGraph(graph, files, projectRoot, cycles);
}

export class MigraguardInsightProvider implements InsightProvider {
  readonly name = INSIGHT_PROVIDER_NAME;

  async provide(query: InsightQuery): Promise<ExternalInsight> {
    return buildExternalInsight({ projectRoot: query.projectRoot });
  }
}

export function createMigraguardInsightProvider(): MigraguardInsightProvider {
  return new MigraguardInsightProvider();
}
