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
