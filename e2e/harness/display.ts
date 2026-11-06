import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

// One X server per launch: on a shared display each new window takes the focus from the others,
// so parallel workers would blur each other's windows (docs/testing.md → Virtual display).

// Pinned, since Xvfb's default varies by build: a screen under the 1280x800 window drops the
// renderer below the 1024px desktop breakpoint, and the suite would test the narrow layout.
const SCREEN = '1920x1080x24'
const START_TIMEOUT_MS = 10_000
const STDERR_TAIL_CHARS = 2000

export type Display = {
  /** Merged into the app's environment; empty when the app runs on the real screen. */
  env: { DISPLAY?: string }
  /** The display's server, which its launch stops after the app. */
  server?: ChildProcess
}

const running = new Set<ChildProcess>()
const clients = new Set<ChildProcess>()
// A worker that throws mid-test never reaches its launches' close. Clients go first: Electron
// left without its X server spins and ignores SIGTERM. A SIGKILLed worker runs no hook at all.
process.on('exit', () => {
  for (const client of clients) client.kill('SIGKILL')
  for (const server of running) server.kill()
})

/** An app process outside Playwright, which kills its own launches on exit. */
export function trackClient(proc: ChildProcess): void {
  clients.add(proc)
  proc.once('exit', () => clients.delete(proc))
}

/** A fresh virtual display when scripts/e2e.ts asked for one, else the inherited screen. */
export function startDisplay(): Promise<Display> {
  if (process.env.E2E_VIRTUAL_DISPLAY !== '1') return Promise.resolve({ env: {} })
  // -displayfd picks a free display number and writes it once the server accepts clients.
  const server = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', SCREEN, '-nolisten', 'tcp'], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
  })
  running.add(server)
  server.once('exit', () => running.delete(server))
  let stderr = ''
  server.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS)
  })

  return new Promise((resolve, reject) => {
    let settled = false
    let written = ''
    const fail = (reason: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.kill('SIGKILL')
      reject(new Error(`Xvfb ${reason}${stderr ? `:\n${stderr}` : ''}`))
    }
    const timer = setTimeout(
      () => fail(`gave no display within ${START_TIMEOUT_MS} ms`),
      START_TIMEOUT_MS,
    )
    ;(server.stdio[3] as Readable).on('data', (chunk: Buffer) => {
      written += chunk.toString()
      if (settled || !written.includes('\n')) return
      settled = true
      clearTimeout(timer)
      resolve({ env: { DISPLAY: `:${written.trim()}` }, server })
    })
    server.once('error', (err) => fail(`failed to start (${err.message})`))
    server.once('exit', (code, signal) =>
      fail(`exited before its display was ready (${signal ?? code})`),
    )
  })
}
