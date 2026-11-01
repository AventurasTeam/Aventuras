import { execFile } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// Orca types a pointer into an idle terminal for any mail a wait's --types leave out, so this
// waits unfiltered and absorbs heartbeats here: each would otherwise cost the agent a turn.

export const WAIT_MS = 3_300_000
const MIN_TIMEOUT_MS = 1_000

export type CheckOutcome = { stdout: string; stderr: string; exitCode: number }
export type Check = (
  run: string,
  ack: string | undefined,
  timeoutMs: number,
) => Promise<CheckOutcome>

export function checkArgs(run: string, ack: string | undefined, timeoutMs: number): string[] {
  return [
    'orchestration',
    'check',
    '--run',
    run,
    ...(ack === undefined ? [] : ['--ack', ack]),
    '--wait',
    '--timeout-ms',
    String(timeoutMs),
    '--json',
  ]
}

export function parseWaitArgs(argv: string[]): { run: string; ack: string | undefined } {
  const { values } = parseArgs({
    args: argv,
    options: { run: { type: 'string' }, ack: { type: 'string' } },
  })
  if (values.run === undefined) throw new Error('--run <run_id> is required')
  return { run: values.run, ack: values.ack }
}

function withoutKeepalives(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.includes('_keepalive'))
    .join('\n')
    .trim()
}

function heartbeatOnlyDelivery(stdout: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return undefined
  }
  const { ok, result } = parsed as {
    ok?: boolean
    result?: { deliveryId?: string | null; messages?: { type?: string }[] }
  }
  const messages = result?.messages ?? []
  if (!ok || messages.length === 0) return undefined
  if (!messages.every((message) => message.type === 'heartbeat')) return undefined
  return result?.deliveryId ?? undefined
}

export async function waitOnRun(options: {
  run: string
  ack?: string
  check: Check
  now?: () => number
}): Promise<CheckOutcome> {
  const { run, check, now = Date.now } = options
  const deadline = now() + WAIT_MS
  let ack = options.ack
  for (;;) {
    const timeoutMs = Math.max(MIN_TIMEOUT_MS, deadline - now())
    const outcome = await check(run, ack, timeoutMs)
    const stdout = withoutKeepalives(outcome.stdout)
    const delivery = outcome.exitCode === 0 ? heartbeatOnlyDelivery(stdout) : undefined
    // A batch that replays after its ack would otherwise spin here unseen.
    if (delivery === undefined || delivery === ack) {
      return { ...outcome, stdout, stderr: withoutKeepalives(outcome.stderr) }
    }
    ack = delivery
  }
}

function checkWithOrca(...args: Parameters<Check>): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const child = execFile(
      'orca',
      checkArgs(...args),
      { maxBuffer: Infinity },
      (error, stdout, stderr) => {
        process.off('SIGTERM', stopChild)
        process.off('SIGINT', stopChild)
        process.off('SIGHUP', stopChild)
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
        resolve({ stdout, stderr: stderr || (error?.message ?? ''), exitCode })
      },
    )
    // An orphaned check stays a live waiter, and would keep taking this Run's mail for up to an hour.
    function stopChild() {
      child.kill()
      process.exit(1)
    }
    process.on('SIGTERM', stopChild)
    process.on('SIGINT', stopChild)
    process.on('SIGHUP', stopChild)
  })
}

async function main() {
  const { run, ack } = parseWaitArgs(process.argv.slice(2))
  const { stdout, stderr, exitCode } = await waitOnRun({ run, ack, check: checkWithOrca })
  if (stdout) console.log(stdout)
  if (stderr) console.error(stderr)
  process.exitCode = exitCode
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  void main()
}
