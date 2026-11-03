import type { SpawnSyncReturns } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

import { adb, APP_ID } from './adb'
import { isSqliteFile } from './sqlite-file'

// `pnpm device:push-db <file>`: replaces the debug install's database. The app must have run once
// and be debuggable; a release APK installed over it keeps the data. ANDROID_SERIAL is required:
// this overwrites data, and adb would otherwise take whichever single device is attached.
const DEVICE_TMP = '/data/local/tmp/aventuras.db'
const APP_DB = 'files/SQLite/aventuras.db'

// `error` when adb itself couldn't start, which leaves stderr null.
function failureOf(result: SpawnSyncReturns<string>): string {
  return result.error?.message ?? result.stderr.trim()
}

function runAsFailure(result: SpawnSyncReturns<string>): Error {
  return new Error(
    `run-as failed (${failureOf(result)}). ${APP_ID} must be a debuggable install, not release.`,
  )
}

function deviceSize(serial: string): number {
  const count = adb(serial, ['shell', 'run-as', APP_ID, 'wc', '-c', APP_DB])
  if (count.status !== 0) throw runAsFailure(count)
  return Number.parseInt(count.stdout, 10)
}

function main(): void {
  const file = process.argv[2]
  if (file === undefined || !existsSync(file)) {
    throw new Error('usage: pnpm device:push-db <sqlite file>')
  }
  if (!isSqliteFile(file)) throw new Error(`${file} is not a SQLite database`)
  const serial = process.env.ANDROID_SERIAL
  if (!serial) {
    throw new Error("set ANDROID_SERIAL to the target device's serial (see `adb devices`)")
  }

  const state = adb(serial, ['get-state'])
  if (state.status !== 0 || state.stdout.trim() !== 'device') {
    throw new Error(
      `device ${serial} is not reachable (${failureOf(state) || state.stdout.trim()})`,
    )
  }

  const probe = adb(serial, ['shell', 'run-as', APP_ID, 'true'])
  if (probe.status !== 0) throw runAsFailure(probe)

  const stop = adb(serial, ['shell', 'am', 'force-stop', APP_ID])
  if (stop.status !== 0) throw new Error(`force-stop failed: ${failureOf(stop)}`)

  const push = adb(serial, ['push', file, DEVICE_TMP])
  if (push.status !== 0) throw new Error(`adb push failed: ${failureOf(push)}`)

  // The device's own pipe, not spawnSync's `input`: run-as can't read /data/local/tmp itself, and
  // a utf8 pipe from here would corrupt the binary.
  const copy = adb(serial, [
    'shell',
    `cat ${DEVICE_TMP} | run-as ${APP_ID} sh -c 'mkdir -p files/SQLite && cat > ${APP_DB}'`,
  ])
  if (copy.status !== 0) throw runAsFailure(copy)

  // Sidecars left by the previous database would be replayed over the new file.
  const sidecars = ['-wal', '-shm', '-journal'].map((suffix) => `${APP_DB}${suffix}`)
  const clear = adb(serial, ['shell', 'run-as', APP_ID, 'rm', '-f', ...sidecars])
  if (clear.status !== 0) throw new Error(`removing the old sidecars failed: ${failureOf(clear)}`)
  adb(serial, ['shell', 'rm', '-f', DEVICE_TMP])

  const local = statSync(file).size
  const remote = deviceSize(serial)
  if (remote !== local) throw new Error(`size mismatch: local ${local}, device ${remote}`)
  console.log(`[push-db] ${file} -> ${serial}:${APP_ID}:${APP_DB} (${local} bytes)`)
}

try {
  main()
} catch (err) {
  console.error('[push-db]', err instanceof Error ? err.message : err)
  process.exit(1)
}
