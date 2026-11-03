import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const STAGED = 'rm -f /data/local/tmp/aventuras.db'

let dir: string
let db: string
let pushed: string
let log: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'push-db-'))
  db = join(dir, 'source.db')
  pushed = db
  log = join(dir, 'adb.log')
  const sqlite = new DatabaseSync(db)
  sqlite.exec('CREATE TABLE t (id INTEGER)')
  sqlite.close()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

interface FakeAdb {
  /** Calls whose arguments contain any of these fail with the call echoed on stderr. */
  failOn?: string[]
  state?: string
  /** What `wc -c` reports for the app's database; the source's size by default. */
  deviceSize?: number
  /** Null runs with ANDROID_SERIAL unset. */
  serial?: string | null
}

// A stand-in adb on PATH that logs each call.
function runPushDb({ failOn = [], state = 'device', deviceSize, serial = 'fake' }: FakeAdb = {}) {
  const fake = join(dir, 'adb')
  writeFileSync(
    fake,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$*" >> '${log}'`,
      ...failOn.map((part) => `case "$*" in *'${part}'*) echo "failed: $*" >&2; exit 1;; esac`),
      `case "$*" in *get-state*) echo '${state}';; esac`,
      `case "$*" in *'wc -c'*) echo '${deviceSize ?? statSync(db).size} files/SQLite/aventuras.db';; esac`,
      'exit 0',
    ].join('\n'),
  )
  chmodSync(fake, 0o755)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` }
  if (serial === null) delete env.ANDROID_SERIAL
  else env.ANDROID_SERIAL = serial
  const result = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    ['scripts/dev-slot/push-db.ts', pushed],
    { encoding: 'utf8', env },
  )
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []
  return { status: result.status, stderr: result.stderr, calls }
}

describe('push-db', () => {
  it.each([
    ['the push', 'push '],
    ['the copy into the app', 'cat /data/local/tmp'],
    ['clearing the sidecars', 'aventuras.db-wal'],
  ])('removes the staged copy when %s fails', (_, failOn) => {
    const { status, calls } = runPushDb({ failOn: [failOn] })
    expect(status).toBe(1)
    expect(calls.at(-1)).toContain(STAGED)
  })

  it('removes the staged copy once on success, before the size check', () => {
    const { status, calls } = runPushDb()
    expect(status).toBe(0)
    expect(calls.filter((call) => call.includes(STAGED))).toHaveLength(1)
    expect(calls.at(-1)).toContain('wc -c')
    // Where expo-sqlite opens the app's database; the size check reads the same constant.
    expect(calls.some((call) => call.includes('cat > files/SQLite/aventuras.db'))).toBe(true)
  })

  it('fails when the staged copy stays behind after an otherwise good push', () => {
    const { status, stderr, calls } = runPushDb({ failOn: [STAGED] })
    expect(status).toBe(1)
    expect(stderr).toContain('/data/local/tmp/aventuras.db is still on the device')
    expect(calls.at(-1)).toContain(STAGED)
  })

  it('reports the failed step first when the staged copy also stays behind', () => {
    const { status, stderr } = runPushDb({ failOn: ['cat /data/local/tmp', STAGED] })
    expect(status).toBe(1)
    const stepFailure = stderr.indexOf('copying the database into the app failed')
    const leftover = stderr.indexOf('/data/local/tmp/aventuras.db is still on the device')
    expect(stepFailure).toBeGreaterThan(-1)
    expect(leftover).toBeGreaterThan(-1)
    expect(stepFailure).toBeLessThan(leftover)
  })

  it.each([
    ['the copy into the app', 'cat /data/local/tmp'],
    ['the size check', 'wc -c'],
  ])('reports %s failing with its own stderr, not the debuggable advice', (_, failOn) => {
    const { status, stderr } = runPushDb({ failOn: [failOn] })
    expect(status).toBe(1)
    expect(stderr).toContain('failed: -s fake shell')
    expect(stderr).not.toContain('debuggable')
  })

  it.each(['-wal', '-journal'])(
    'refuses a source with a %s sidecar before any device call',
    (suffix) => {
      writeFileSync(`${db}${suffix}`, 'pending changes')
      const { status, stderr, calls } = runPushDb()
      expect(status).toBe(1)
      expect(stderr).toContain(`${db}${suffix}`)
      expect(calls).toEqual([])
    },
  )

  it('refuses a symlinked source whose target has a -wal sidecar', () => {
    pushed = join(dir, 'link.db')
    symlinkSync(db, pushed)
    writeFileSync(`${db}-wal`, 'pending changes')
    const { status, stderr, calls } = runPushDb()
    expect(status).toBe(1)
    expect(stderr).toContain(`${realpathSync(db)}-wal`)
    expect(calls).toEqual([])
  })
})
