import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DRAFT_PREFIX = '.dataset-export-'
const MIN_SCANNED_KEY_LENGTH = 16
const SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'] as const

const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

/**
 * Throws on a target the export can't publish to as named, a sidecar that would replay over the
 * copy, or a killed export's draft (unscrubbed, key included). Run before a build's drive too.
 */
export function assertExportTarget(out: string): void {
  if (!isAbsolute(out)) throw new Error(`export target ${out}: not an absolute path`)
  if (out.endsWith(sep)) throw new Error(`export target ${out}: ends in a path separator`)
  if (isDirectory(out)) throw new Error(`export target ${out}: is a directory`)
  const dir = dirname(out)
  if (!isDirectory(dir)) throw new Error(`export target ${out}: ${dir} is not a directory`)
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    throw new Error(`export target ${out}: ${dir} is not writable`)
  }
  for (const suffix of SIDECAR_SUFFIXES)
    if (existsSync(`${out}${suffix}`))
      throw new Error(`${out}${suffix} would replay over the export`)
  const drafts = readdirSync(dir).filter((name) => name.startsWith(DRAFT_PREFIX))
  if (drafts.length > 0)
    throw new Error(
      `delete ${drafts.map((name) => join(dir, name)).join(', ')}: a killed export's draft, which can hold a provider key`,
    )
}

/**
 * Throws on a non-empty key under 16 characters: `exportScrubbed` refuses a copy holding a key's
 * bytes anywhere, and a placeholder that short (`dev`) matches unrelated text after the drive.
 */
export function assertScannableKey(key: string): void {
  if (key !== '' && key.length < MIN_SCANNED_KEY_LENGTH)
    throw new Error(
      `the provider key is ${key.length} characters, under ${MIN_SCANNED_KEY_LENGTH}: the export's byte scan for it would match unrelated text and refuse the export after the drive`,
    )
}

/** Blanks every provider's API key in a dataset export; VACUUM drops the pages that held one. */
export function scrubProviderKeys(dbPath: string): void {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare(`SELECT providers FROM app_settings WHERE id = 'singleton'`).get() as
      | { providers: string }
      | undefined
    if (row === undefined) throw new Error(`${dbPath} holds no app settings`)
    const providers = (JSON.parse(row.providers) as Record<string, unknown>[]).map((provider) => ({
      ...provider,
      apiKey: '',
    }))
    db.prepare(`UPDATE app_settings SET providers = ? WHERE id = 'singleton'`).run(
      JSON.stringify(providers),
    )
    db.exec('VACUUM')
  } finally {
    db.close()
  }
}

/**
 * Publishes a scrubbed copy of `src` at `out`, built in a fresh directory beside it so the rename
 * stays on one filesystem; on any failure nothing lands at `out`. Throws if a secret survives.
 */
export function exportScrubbed(src: string, out: string, secrets: readonly string[]): void {
  const dir = mkdtempSync(join(dirname(out), DRAFT_PREFIX))
  try {
    const draft = join(dir, basename(out))
    copyFileSync(src, draft)
    scrubProviderKeys(draft)
    for (const suffix of SIDECAR_SUFFIXES)
      if (existsSync(`${draft}${suffix}`)) throw new Error(`${draft}${suffix} outlived the scrub`)
    const bytes = readFileSync(draft)
    if (secrets.some((secret) => secret !== '' && bytes.includes(secret)))
      throw new Error('the scrubbed copy still holds a provider key')
    renameSync(draft, out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
