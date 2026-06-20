# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in migraguard, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities
2. Email the maintainers or use GitHub's private vulnerability reporting feature
3. Include a clear description of the vulnerability, steps to reproduce, and potential impact
4. Allow reasonable time for a fix before public disclosure

## Trust Model

migraguard is a development and deployment tool that executes operations on your behalf. The following components have elevated trust:

### Migration SQL Files

Migration files are executed directly via the database's native CLI (`psql`, `mysql`, or `sqlite3`). They have full access to the target database with whatever privileges the configured connection provides.

- `migraguard apply` passes each SQL file to the database CLI for execution
- There is no sandboxing or SQL statement filtering — the file is trusted code
- Treat migration files with the same security posture as application source code

### Custom Lint Rules (`customRulesDir`)

Custom lint rules are loaded as JavaScript/TypeScript modules via dynamic `import()`. They execute with the full privileges of the current Node.js process.

- Rules can read/write the filesystem, make network calls, and execute subprocesses
- Only point `customRulesDir` at directories you control and trust
- Review third-party lint rule packages before use

### LLM-Powered Commands

Commands that use LLM adapters (`implement`, `audit`, `audit-workflow`, `propose-expand-contract`, `explain`) send project context to external LLM APIs and receive generated content.

- Generated migration SQL should be reviewed before applying to any environment
- The `implement` command writes files to the configured `migrationsDirs` or `--output-dir`
- LLM output may contain incorrect or unsafe SQL — the deterministic lint gate provides a safety net, but human review remains essential
- API keys are read from environment variables and transmitted to the configured LLM provider

### `pgDumpCommand` / CLI Tool Configuration

The `pgDumpCommand` config option specifies the binary used for schema dumps. This binary is executed as a subprocess with the current user's privileges.

- Do not set this to untrusted binaries
- The default (`pg_dump`, `mysqldump`, `sqlite3`) assumes these are installed from trusted sources

### Environment Variables

Database credentials are read from environment variables (`PGPASSWORD`, `MYSQL_PWD`, etc.) or from the `connection` config object. These are passed to CLI subprocesses.

## Recommendations

1. **Never run `migraguard apply` on untrusted repositories** — migration SQL files are arbitrary code executed against your database
2. **Review AI-generated migrations before applying** — LLM output passes through `lint` but may still contain logically unsafe operations that lint rules cannot detect
3. **Do not use `customRulesDir` with untrusted rule sources** — custom rules execute as JavaScript with full process privileges
4. **Restrict database credentials** — use least-privilege database users for CI/CD environments; avoid granting superuser access to the migration runner
5. **Pin dependencies** — ensure `libpg-query`, `node-sql-parser`, and other parsing libraries are installed from trusted sources

## Scope

This security policy covers the `migraguard` npm package. Issues in upstream dependencies (libpg-query, node-sql-parser, pg, mysql2, better-sqlite3) should be reported to their respective maintainers.
