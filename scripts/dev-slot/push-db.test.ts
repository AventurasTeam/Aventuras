import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const STAGED = 'rm -f /data/local/tmp/aventuras.db'

let dir: string
let db: string
let log: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'push-db-'))
  db = join(dir, 'source.db')
  log = join(dir, 'adb.log')
  const sqlite = new DatabaseSync(db)
  sqlite.exec('CREATE TABLE t (id INTEGER)')
  sqlite.close()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// A stand-in adb on PATH: logs each call and fails the one whose arguments contain `failOn`.
function runPushDb(failOn: string) {
  const fake = join(dir, 'adb')
  writeFileSync(
    fake,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> '${log}'`,
      `case "$*" in *'${failOn}'*) echo failed >&2; exit 1;; esac`,
      'case "$*" in *get-state*) echo device;; esac',
      `case "$*" in *'wc -c'*) echo '${statSync(db).size} files/SQLite/aventuras.db';; esac`,
      'exit 0',
    ].join('\n'),
  )
  chmodSync(fake, 0o755)
  const result = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    ['scripts/dev-slot/push-db.ts', db],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        ANDROID_SERIAL: 'fake',
        PATH: `${dir}${delimiter}${process.env.PATH}`,
      },
    },
  )
  return { status: result.status, calls: readFileSync(log, 'utf8').trim().split('\n') }
}

describe('push-db', () => {
  it.each([
    ['the push', 'push '],
    ['the copy into the app', 'cat /data/local/tmp'],
    ['clearing the sidecars', 'aventuras.db-wal'],
  ])('removes the staged copy when %s fails', (_, failOn) => {
    const { status, calls } = runPushDb(failOn)
    expect(status).toBe(1)
    expect(calls.at(-1)).toContain(STAGED)
  })

  it('removes the staged copy once on success, before the size check', () => {
    const { status, calls } = runPushDb('no call matches this')
    expect(status).toBe(0)
    expect(calls.filter((call) => call.includes(STAGED))).toHaveLength(1)
    expect(calls.at(-1)).toContain('wc -c')
    // Where expo-sqlite opens the app's database; the size check reads the same constant.
    expect(calls.some((call) => call.includes('cat > files/SQLite/aventuras.db'))).toBe(true)
  })
})
