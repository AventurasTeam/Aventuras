import { copyFileSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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
  const dir = mkdtempSync(join(dirname(out), '.dataset-export-'))
  try {
    const draft = join(dir, basename(out))
    copyFileSync(src, draft)
    scrubProviderKeys(draft)
    for (const suffix of ['-wal', '-shm', '-journal'])
      if (existsSync(`${draft}${suffix}`)) throw new Error(`${draft}${suffix} outlived the scrub`)
    const bytes = readFileSync(draft)
    if (secrets.some((secret) => secret !== '' && bytes.includes(secret)))
      throw new Error('the scrubbed copy still holds a provider key')
    renameSync(draft, out)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
