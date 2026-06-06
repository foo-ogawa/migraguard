#!/usr/bin/env node
import { build } from "esbuild";
import { readFileSync, statSync } from "node:fs";

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

const result = await build({
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
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
