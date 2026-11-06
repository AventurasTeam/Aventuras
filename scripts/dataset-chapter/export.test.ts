import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { scrubProviderKeys } from './export'

const KEY = 'sk-dataset-test-0123456789abcdef'
const MODELS = Array.from({ length: 300 }, (_, i) => ({
  id: `vendor/model-${i}`,
  capabilities: {},
}))

function settingsDb(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'dataset-export-')), 'aventuras.db')
  const db = new DatabaseSync(path)
  db.exec(`CREATE TABLE app_settings (id TEXT PRIMARY KEY, providers TEXT NOT NULL)`)
  // A hosted provider's model list runs past a page: the key lands on an overflow page, which an
  // UPDATE frees without zeroing.
  const providers = [
    { id: 'prov_local', apiKey: '', endpoint: 'http://127.0.0.1:4319/v1' },
    { id: 'prov_dev', cachedModels: MODELS, apiKey: KEY, endpoint: 'https://api.example.test/v1' },
  ]
  db.prepare(`INSERT INTO app_settings (id, providers) VALUES ('singleton', ?)`).run(
    JSON.stringify(providers),
  )
  db.close()
  return path
}

describe('scrubProviderKeys', () => {
  it('blanks every provider key and keeps the rest of each provider', () => {
    const path = settingsDb()
    scrubProviderKeys(path)
    const db = new DatabaseSync(path)
    const row = db.prepare(`SELECT providers FROM app_settings WHERE id = 'singleton'`).get() as {
      providers: string
    }
    db.close()
    expect(JSON.parse(row.providers)).toEqual([
      { id: 'prov_local', apiKey: '', endpoint: 'http://127.0.0.1:4319/v1' },
      { id: 'prov_dev', cachedModels: MODELS, apiKey: '', endpoint: 'https://api.example.test/v1' },
    ])
  })

  it('leaves no byte of a key in the file', () => {
    const path = settingsDb()
    expect(readFileSync(path).includes(KEY)).toBe(true)
    scrubProviderKeys(path)
    expect(readFileSync(path).includes(KEY)).toBe(false)
  })
})
