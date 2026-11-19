#!/usr/bin/env node
import { build } from "esbuild";
import { readFileSync, rmSync, statSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const minify = process.argv.includes("--minify");

const externalSdks = [
  // LLM SDKs
  "@anthropic-ai/claude-agent-sdk",
  "@anthropic-ai/sdk",
  "@openai/agents",
  "@google/adk",
  // Native modules
  "libpg-query",
  "pg",
  "better-sqlite3",
  "mysql2",
];

const resolveRuntimeDynamicImports = {
  name: "resolve-runtime-dynamic-imports",
  setup(_build) {},
};

const inlineBuildTimeConstants = {
  name: "inline-build-time-constants",
  setup(build) {
    // Version is read in src/index.ts via createRequire
    build.onLoad({ filter: /src[\\/]index\.ts$/ }, async (args) => {
      let contents = readFileSync(args.path, "utf8");
      contents = contents.replace(
        /import \{ createRequire \} from ['"]node:module['"];\n\nconst require = createRequire\(import\.meta\.url\);\n\nexport const pkg = require\(['"]\.\.\/package\.json['"]\) as \{[\s\S]*?\};\n/,
        `export const pkg = { name: ${JSON.stringify(pkg.name)}, version: ${JSON.stringify(pkg.version)}, description: ${JSON.stringify(pkg.description)} };\n`,
      );
      return { contents, loader: "ts" };
    });

    // Strip shebang from CLI entry if present
    build.onLoad({ filter: /cli[\\/]index\.ts$/ }, async (args) => {
      let contents = readFileSync(args.path, "utf8");
      contents = contents.replace(/^#!.*\n/, "");
      return { contents, loader: "ts" };
    });
  },
};

const target = "node22";

if (process.argv.includes("--lib")) {
  // The library entries keep what the package declares as dependencies external, so a
  // consumer resolves them from its own install; the rest of the source is bundled into
  // each entry. Type declarations are written by `tsc -p tsconfig.build.json`.
  rmSync("dist", { recursive: true, force: true });
  const lib = await build({
    entryPoints: {
      index: "src/index.ts",
      cli: "src/cli/index.ts",
      "external/insight-provider": "src/external/insight-provider.ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    target,
    outdir: "dist",
    sourcemap: true,
    external: [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
      "commander",
      ...externalSdks,
    ],
    logLevel: "info",
  });
  process.exit(lib.errors.length > 0 ? 1 : 0);
}

const result = await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target,
  outfile: "dist/migraguard.bundle.mjs",
  minify,
  sourcemap: true,
  external: externalSdks,
  mainFields: ["module", "main"],
  conditions: ["import", "node"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __banner_createRequire } from 'module';",
      "const require = __banner_createRequire(import.meta.url);",
    ].join("\n"),
  },
  plugins: [resolveRuntimeDynamicImports, inlineBuildTimeConstants],
  logLevel: "info",
});

if (result.errors.length > 0) process.exit(1);
const stat = statSync("dist/migraguard.bundle.mjs");
const sizeKB = (stat.size / 1024).toFixed(1);
const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
console.log(`\n✓ dist/migraguard.bundle.mjs  ${sizeKB} KB (${sizeMB} MB)`);
