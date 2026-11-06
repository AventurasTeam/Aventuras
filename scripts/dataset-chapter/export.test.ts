import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertExportTarget, exportScrubbed, scrubProviderKeys } from './export'

const KEY = 'sk-dataset-test-0123456789abcdef'
const MODELS = Array.from({ length: 300 }, (_, i) => ({
  id: `vendor/model-${i}`,
  capabilities: {},
}))

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dataset-export-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function settingsDb(): string {
  const path = join(root, 'aventuras.db')
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

function outDir(): string {
  const dir = join(root, 'out')
  mkdirSync(dir)
  return dir
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

describe('exportScrubbed', () => {
  it('publishes a scrubbed copy at the target and leaves nothing else beside it', () => {
    const src = settingsDb()
    const dir = outDir()
    const out = join(dir, 'dataset.db')
    exportScrubbed(src, out, [KEY])
    expect(readFileSync(out).includes(KEY)).toBe(false)
    expect(readdirSync(dir)).toEqual(['dataset.db'])
  })

  // A keyless build passes its empty key, and every file holds the empty string.
  it('passes over an empty secret', () => {
    const src = settingsDb()
    const out = join(outDir(), 'dataset.db')
    exportScrubbed(src, out, ['', KEY])
    expect(readFileSync(out).includes(KEY)).toBe(false)
  })

  it('publishes nothing when the scrub fails', () => {
    const src = join(root, 'no-settings.db')
    const db = new DatabaseSync(src)
    db.exec(`CREATE TABLE app_settings (id TEXT PRIMARY KEY, providers TEXT NOT NULL)`)
    db.close()
    const dir = outDir()
    const out = join(dir, 'dataset.db')
    expect(() => exportScrubbed(src, out, [KEY])).toThrow(/holds no app settings/)
    expect(existsSync(out)).toBe(false)
    expect(readdirSync(dir)).toEqual([])
  })

  it('publishes nothing when a key survives outside the provider settings', () => {
    const src = settingsDb()
    const db = new DatabaseSync(src)
    db.exec(`CREATE TABLE log (line TEXT NOT NULL)`)
    db.prepare(`INSERT INTO log (line) VALUES (?)`).run(`request failed with key ${KEY}`)
    db.close()
    const dir = outDir()
    const out = join(dir, 'dataset.db')
    expect(() => exportScrubbed(src, out, [KEY])).toThrow(/still holds a provider key/)
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('assertExportTarget', () => {
  it('passes a new file in an existing folder, and an earlier export to replace', () => {
    const out = join(outDir(), 'dataset.db')
    expect(() => assertExportTarget(out)).not.toThrow()
    writeFileSync(out, '')
    expect(() => assertExportTarget(out)).not.toThrow()
  })

  it('refuses a relative path', () => {
    expect(() => assertExportTarget(join('datasets', 'dataset.db'))).toThrow(/not an absolute path/)
  })

  it('refuses a path ending in a separator', () => {
    expect(() => assertExportTarget(`${join(outDir(), 'dataset')}${sep}`)).toThrow(
      /ends in a path separator/,
    )
  })

  it('refuses a directory at the target', () => {
    const out = join(outDir(), 'dataset.db')
    mkdirSync(out)
    expect(() => assertExportTarget(out)).toThrow(/is a directory/)
  })

  it('refuses a folder that is missing, or a file', () => {
    expect(() => assertExportTarget(join(root, 'missing', 'dataset.db'))).toThrow(
      /is not a directory/,
    )
    writeFileSync(join(root, 'file'), '')
    expect(() => assertExportTarget(join(root, 'file', 'dataset.db'))).toThrow(/is not a directory/)
  })

  it.each(['-wal', '-shm', '-journal'])('refuses a %s beside the target', (suffix) => {
    const out = join(outDir(), 'dataset.db')
    writeFileSync(`${out}${suffix}`, '')
    expect(() => assertExportTarget(out)).toThrow(`${out}${suffix} would replay over the export`)
  })

  it('refuses a draft an interrupted export left beside the target, naming it', () => {
    const dir = outDir()
    const draft = join(dir, '.dataset-export-x1Yz2W')
    mkdirSync(draft)
    expect(() => assertExportTarget(join(dir, 'dataset.db'))).toThrow(draft)
  })
})
