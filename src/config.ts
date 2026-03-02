import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { existsSync } from 'node:fs';

export const CONFIG_FILE_NAME = 'migraguard.config.json';

export interface NamingConfig {
  pattern: string;
  timestamp: string;
  prefix: string;
  sortKey: string;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

export interface DumpConfig {
  normalize: boolean;
  excludeOwners: boolean;
  excludePrivileges: boolean;
  pgDumpCommand?: string[];
}

export interface LintConfig {
  rules: Record<string, boolean>;
  customRulesDir?: string;
}

export interface MigraguardConfig {
  configDir: string;
  migrationsDirs: string[];
  schemaFile: string;
  metadataFile: string;
  naming: NamingConfig;
  connection: ConnectionConfig;
  dump: DumpConfig;
  lint: LintConfig;
}

const DEFAULT_NAMING: NamingConfig = {
  pattern: '{timestamp}__{description}.sql',
  timestamp: 'YYYYMMDD_HHMMSS',
  prefix: '',
  sortKey: 'timestamp',
};

const DEFAULT_CONNECTION: ConnectionConfig = {
  host: 'localhost',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
};

const DEFAULT_DUMP: DumpConfig = {
  normalize: true,
  excludeOwners: true,
  excludePrivileges: true,
};

const DEFAULT_LINT: LintConfig = {
  rules: {
    'require-concurrent-index': true,
    'require-if-not-exists': true,
    'require-lock-timeout': true,
    'ban-concurrent-index-in-transaction': true,
    'adding-not-nullable-field': true,
    'constraint-missing-not-valid': true,
  },
};

export interface RawConfig {
  migrationsDir?: string;
  migrationsDirs?: string[];
  schemaFile?: string;
  metadataFile?: string;
  naming?: Partial<NamingConfig>;
  connection?: Partial<ConnectionConfig>;
  dump?: Partial<DumpConfig>;
  lint?: Partial<LintConfig>;
}

function applyEnvOverrides(connection: ConnectionConfig): ConnectionConfig {
  return {
    host: process.env['PGHOST'] ?? connection.host,
    port: process.env['PGPORT'] ? parseInt(process.env['PGPORT'], 10) : connection.port,
    database: process.env['PGDATABASE'] ?? connection.database,
    user: process.env['PGUSER'] ?? connection.user,
    password: process.env['PGPASSWORD'] ?? connection.password,
  };
}

function resolveMigrationsDirs(raw: RawConfig): string[] {
  if (raw.migrationsDirs && raw.migrationsDirs.length > 0) {
    return raw.migrationsDirs;
  }
  if (raw.migrationsDir) {
    return [raw.migrationsDir];
  }
  return ['db/migrations'];
}

export function findConfigFile(startDir: string): string | undefined {
  let dir = resolve(startDir);
  const root = dirname(dir) === dir ? dir : undefined;

  while (true) {
    const candidate = resolve(dir, CONFIG_FILE_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) {
      return undefined;
    }
    dir = parent;
  }
}

export function buildConfig(raw: RawConfig, configDir: string): MigraguardConfig {
  const connection: ConnectionConfig = {
    ...DEFAULT_CONNECTION,
    ...raw.connection,
  };

  return {
    configDir,
    migrationsDirs: resolveMigrationsDirs(raw),
    schemaFile: raw.schemaFile ?? 'db/schema.sql',
    metadataFile: raw.metadataFile ?? 'db/.migraguard/metadata.json',
    naming: { ...DEFAULT_NAMING, ...raw.naming },
    connection: applyEnvOverrides(connection),
    dump: { ...DEFAULT_DUMP, ...raw.dump },
    lint: {
      ...DEFAULT_LINT,
      ...raw.lint,
      rules: { ...DEFAULT_LINT.rules, ...raw.lint?.rules },
    },
  };
}

export async function loadConfig(startDir?: string): Promise<MigraguardConfig> {
  const cwd = startDir ?? process.cwd();
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return buildConfig({}, cwd);
  }

  const content = await readFile(configPath, 'utf-8');
  let raw: RawConfig;
  try {
    raw = JSON.parse(content) as RawConfig;
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  return buildConfig(raw, dirname(configPath));
}

export function resolveFromConfig(config: MigraguardConfig, relativePath: string): string {
  return resolve(config.configDir, relativePath);
}
