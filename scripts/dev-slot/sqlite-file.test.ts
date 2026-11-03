import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { isSqliteFile } from './sqlite-file'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sqlite-file-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('isSqliteFile', () => {
  it('accepts a database SQLite wrote', () => {
    const path = join(dir, 'real.db')
    const db = new DatabaseSync(path)
    db.exec('CREATE TABLE t (id INTEGER)')
    db.close()
    expect(isSqliteFile(path)).toBe(true)
  })

  it('rejects a file of another kind', () => {
    const path = join(dir, 'export.json')
    writeFileSync(path, '{"stories": []}')
    expect(isSqliteFile(path)).toBe(false)
  })

  it('rejects a file shorter than the header', () => {
    const path = join(dir, 'short.db')
    writeFileSync(path, 'SQLite')
    expect(isSqliteFile(path)).toBe(false)
  })

  // Opening a FIFO blocks until a writer appears; a directory fails the read with EISDIR.
  it('rejects a path that is not a regular file, without opening it', () => {
    const path = join(dir, 'folder.db')
    mkdirSync(path)
    expect(isSqliteFile(path)).toBe(false)
  })

  it('rejects an empty file', () => {
    const path = join(dir, 'empty.db')
    writeFileSync(path, '')
    expect(isSqliteFile(path)).toBe(false)
  })
})
