import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only last line of defense over drizzle-kit generated migrations. It
// reports byte-level corruption and exits non-zero, but never rewrites: the SQL
// content is hashed by drizzle-orm at runtime and meta/ snapshots are
// checksummed, so auto-formatting would desync them at app startup. Tabs are
// intentionally NOT flagged — drizzle-kit indents generated SQL with tabs.

const MIGRATIONS_DIR = fileURLToPath(new URL('../lib/db/migrations', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

type Violation = { file: string; line: number; reason: string }

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

function inspect(file: string): Violation[] {
  const rel = relative(REPO_ROOT, file)
  const buf = readFileSync(file)
  const violations: Violation[] = []

  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    violations.push({ file: rel, line: 1, reason: 'UTF-8 BOM' })
  }

  buf
    .toString('utf8')
    .split('\n')
    .forEach((rawLine, index) => {
      const line = index + 1
      if (rawLine.includes('\r')) {
        violations.push({ file: rel, line, reason: 'CRLF / carriage return' })
      }
      // Strip a trailing CR first so it isn't double-counted as trailing space.
      if (/[ \t]+$/.test(rawLine.replace(/\r$/, ''))) {
        violations.push({ file: rel, line, reason: 'trailing whitespace' })
      }
    })

  return violations
}

const files = walk(MIGRATIONS_DIR)
const violations = files.flatMap(inspect)

if (violations.length > 0) {
  console.error(`✗ ${violations.length} migration format violation(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.reason}`)
  }
  console.error(
    `\nThese files are drizzle-kit generated and must stay LF, no BOM, no trailing whitespace.` +
      `\nDo not auto-format them — restore from git or re-run 'pnpm db:generate' instead.`,
  )
  process.exit(1)
}

console.log(`✓ ${files.length} migration file(s) clean (LF, no BOM, no trailing whitespace).`)
