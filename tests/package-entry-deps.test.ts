import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  exports: Record<string, { import: string }>;
  dependencies: Record<string, string>;
};

/** Maps a published entry back to the source file it is built from. */
function entrySource(publishedPath: string): string {
  return publishedPath.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
}

const IMPORT_RE = /(?:import|export)[^;'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolveRelative(from: string, specifier: string): string | null {
  const base = normalize(join(dirname(from), specifier));
  for (const candidate of [base.replace(/\.js$/, '.ts'), base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(join(root, candidate))) return candidate;
  }
  return null;
}

/** Every bare specifier reachable from the published entry points. */
function reachableBareImports(entries: string[]): Map<string, string> {
  const seen = new Set<string>();
  const bare = new Map<string, string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    const source = readFileSync(join(root, file), 'utf-8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!specifier) continue;

      if (specifier.startsWith('.')) {
        const resolved = resolveRelative(file, specifier);
        expect(resolved, `${file} imports ${specifier}`).not.toBeNull();
        // Assets such as the imported package.json ship with the package and
        // carry no imports of their own.
        if (resolved!.endsWith('.ts')) queue.push(resolved!);
      } else if (!specifier.startsWith('node:') && !builtinModules.includes(specifier)) {
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        if (!bare.has(name)) bare.set(name, file);
      }
    }
  }

  return bare;
}

describe('published entry points', () => {
  const entries = Object.values(pkg.exports).map((e) => entrySource(e.import));

  it('maps every published entry to a source file', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(existsSync(join(root, entry)), entry).toBe(true);
    }
  });

  // A package installed from the registry brings its dependencies and nothing
  // else, so anything the entry points reach has to be declared as one.
  it('import only packages declared in dependencies', () => {
    const bare = reachableBareImports(entries);
    expect(bare.size).toBeGreaterThan(0);

    const undeclared = [...bare]
      .filter(([name]) => !(name in pkg.dependencies))
      .map(([name, file]) => `${name} (imported by ${file})`);

    expect(undeclared).toEqual([]);
  });
});
