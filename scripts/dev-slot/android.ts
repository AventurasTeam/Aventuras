import { spawn, spawnSync } from 'node:child_process'
import { openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { withDebugHttpHost } from './android-prefs'
import { resolveDevSlot } from './resolve'

// `pnpm dev:android`: Metro on this slot's port, and the device pointed at it, so one debug APK
// serves every slot. A worker slot boots its own headless emulator; slot 0 uses whatever device
// is attached, on the default :8081.
const APP_ID = 'com.aventuras.app'
const PREFS = `shared_prefs/${APP_ID}_preferences.xml`
const BOOT_TIMEOUT_MS = 180_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function adb(serial: string | undefined, args: string[], input?: string) {
  const target = serial ? ['-s', serial] : []
  return spawnSync('adb', [...target, ...args], { encoding: 'utf8', input })
}

async function bootEmulator(avd: string, consolePort: number, serial: string): Promise<void> {
  const avds = spawnSync('emulator', ['-list-avds'], { encoding: 'utf8' }).stdout.split('\n')
  if (!avds.includes(avd)) {
    throw new Error(
      `no AVD named ${avd}. Create one, e.g.\n  avdmanager create avd -n ${avd} -k "system-images;android-36.1;google_apis_playstore;x86_64" -d medium_phone`,
    )
  }
  const log = join(tmpdir(), `aventuras-${avd}.log`)
  console.log(`[dev:android] booting ${avd} headless on ${serial} (log: ${log})`)
  const out = openSync(log, 'a')
  // Software rendering: the host GPU path needs a display, which a headless worker lacks.
  spawn(
    'emulator',
    [
      '-avd',
      avd,
      '-port',
      String(consolePort),
      '-no-window',
      '-no-audio',
      '-no-boot-anim',
      '-no-snapshot-save',
      '-gpu',
      'swiftshader_indirect',
    ],
    { detached: true, stdio: ['ignore', out, out] },
  ).unref()

  const deadline = Date.now() + BOOT_TIMEOUT_MS
  while (adb(serial, ['shell', 'getprop', 'sys.boot_completed']).stdout.trim() !== '1') {
    if (Date.now() > deadline) throw new Error(`${avd} did not finish booting; see ${log}`)
    await sleep(2_000)
  }
}

/** Points the stopped app's bundler address at `host`; false when the app isn't installed. */
function setDebugHttpHost(serial: string, host: string): boolean {
  if (!adb(serial, ['shell', 'pm', 'path', APP_ID]).stdout.includes('package:')) return false
  // A running app would keep its cached address and rewrite the prefs on exit.
  adb(serial, ['shell', 'am', 'force-stop', APP_ID])
  const read = adb(serial, ['shell', 'run-as', APP_ID, 'cat', PREFS])
  const xml = withDebugHttpHost(read.status === 0 ? read.stdout : undefined, host)
  const write = adb(
    serial,
    ['shell', `run-as ${APP_ID} sh -c 'mkdir -p shared_prefs && cat > ${PREFS}'`],
    xml,
  )
  if (write.status !== 0) throw new Error(`could not write ${PREFS}: ${write.stderr.trim()}`)
  return true
}

async function main(): Promise<void> {
  const { slot, ports, android } = resolveDevSlot()
  const serial = android?.serial ?? process.env.ANDROID_SERIAL
  const port = `tcp:${ports.metro}`

  if (android && adb(serial, ['get-state']).stdout.trim() !== 'device') {
    await bootEmulator(android.avd, android.consolePort, android.serial)
  }
  const reverse = adb(serial, ['reverse', port, port])
  if (reverse.status !== 0) throw new Error(`adb reverse failed: ${reverse.stderr.trim()}`)
  if (android && !setDebugHttpHost(android.serial, `localhost:${ports.metro}`)) {
    console.warn(
      `[dev:android] ${APP_ID} is not installed on ${android.serial}; install the debug APK and rerun.`,
    )
  }

  const target = serial ? `-s ${serial} ` : ''
  console.log(`[dev:android] slot ${slot}: device -> Metro on localhost:${ports.metro}`)
  console.log(`[dev:android] launch: adb ${target}shell am start -n ${APP_ID}/.MainActivity`)

  // `pnpm desktop` in the same worktree already runs Metro on this port; it serves Android too.
  const status = await fetch(`http://localhost:${ports.metro}/status`).then(
    (res) => res.text(),
    () => '',
  )
  if (status.includes('packager-status:running')) {
    console.log(`[dev:android] reusing the Metro already running on :${ports.metro}`)
    return
  }

  const metro = spawn('expo', ['start', '--dev-client', '--port', String(ports.metro)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => metro.kill('SIGTERM'))
  metro.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
}

main().catch((err: unknown) => {
  console.error('[dev:android]', err instanceof Error ? err.message : err)
  process.exit(1)
})
