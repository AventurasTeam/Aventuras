import { describe, expect, it } from 'vitest'

import { type CheckOutcome, checkArgs, parseWaitArgs, waitOnRun, WAIT_MS } from './orca-run-wait'

function batch(deliveryId: string, ...types: string[]): string {
  const messages = types.map((type, index) => ({ id: `msg_${index}`, type }))
  return JSON.stringify({ ok: true, result: { deliveryId, messages, count: messages.length } })
}

const TIMED_OUT = JSON.stringify({
  ok: true,
  result: { deliveryId: null, messages: [], count: 0, timedOut: true },
})

function succeeded(stdout: string): CheckOutcome {
  return { stdout, stderr: '', exitCode: 0 }
}

function replay(outcomes: CheckOutcome[], clock: number[] = []) {
  const calls: { ack: string | undefined; timeoutMs: number }[] = []
  const pending = [...outcomes]
  const check = (_run: string, ack: string | undefined, timeoutMs: number) => {
    calls.push({ ack, timeoutMs })
    return Promise.resolve(pending.length > 1 ? pending.shift()! : pending[0]!)
  }
  const ticks = [...clock]
  const now = () => (ticks.length > 1 ? ticks.shift()! : (ticks[0] ?? 0))
  return { calls, check, now }
}

describe('waitOnRun', () => {
  it('keeps heartbeat-only batches from the agent, acknowledging each with the next wait', async () => {
    const { calls, check, now } = replay([
      succeeded(batch('d1', 'heartbeat')),
      succeeded(batch('d2', 'heartbeat', 'heartbeat')),
      succeeded(batch('d3', 'question')),
    ])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(JSON.parse(outcome.stdout).result.deliveryId).toBe('d3')
    expect(calls.map((call) => call.ack)).toEqual([undefined, 'd1', 'd2'])
  })

  it('acknowledges a delivery it was given before it waits', async () => {
    const { calls, check, now } = replay([succeeded(batch('d1', 'status'))])

    await waitOnRun({ run: 'run_x', ack: 'd0', check, now })

    expect(calls[0]?.ack).toBe('d0')
  })

  it('hands a mixed batch to the agent unacknowledged', async () => {
    const { calls, check, now } = replay([succeeded(batch('d1', 'heartbeat', 'worker_done'))])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
    expect(JSON.parse(outcome.stdout).result.deliveryId).toBe('d1')
  })

  it('hands status mail to the agent', async () => {
    const { calls, check, now } = replay([succeeded(batch('d1', 'status'))])

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
  })

  it('reports a timeout as a successful checkpoint', async () => {
    const { check, now } = replay([succeeded(TIMED_OUT)])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(outcome.exitCode).toBe(0)
    expect(JSON.parse(outcome.stdout).result.timedOut).toBe(true)
  })

  it('keeps a failed check’s exit code and stderr', async () => {
    const failed = { stdout: '{"ok":false}', stderr: 'consumer_fenced', exitCode: 3 }
    const { check, now } = replay([failed])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(outcome).toEqual(failed)
  })

  it('never reads a failed check as heartbeats', async () => {
    const failed = { stdout: batch('d1', 'heartbeat'), stderr: 'lost', exitCode: 1 }
    const { calls, check, now } = replay([failed])

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
  })

  it('never reads a refused result as heartbeats', async () => {
    const refused = JSON.stringify({
      ok: false,
      result: { deliveryId: 'd1', messages: [{ type: 'heartbeat' }] },
    })
    const { calls, check, now } = replay([succeeded(refused)])

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
  })

  it('never reads an empty batch as heartbeats', async () => {
    const { calls, check, now } = replay([succeeded(batch('d1'))])

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
  })

  it('stops rather than spinning when an acknowledgement does not clear its batch', async () => {
    const { calls, check, now } = replay([succeeded(batch('d1', 'heartbeat'))])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(calls.map((call) => call.ack)).toEqual([undefined, 'd1'])
    expect(JSON.parse(outcome.stdout).result.deliveryId).toBe('d1')
  })

  it('hands unparseable output to the agent', async () => {
    const { calls, check, now } = replay([succeeded('not json')])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(calls).toHaveLength(1)
    expect(outcome.stdout).toBe('not json')
  })

  it('drops keepalive lines from both streams', async () => {
    const keepalive = '{"_keepalive":true}'
    const { check, now } = replay([
      {
        stdout: `${keepalive}\n${batch('d1', 'status')}`,
        stderr: `${keepalive}\nfailed`,
        exitCode: 0,
      },
    ])

    const outcome = await waitOnRun({ run: 'run_x', check, now })

    expect(outcome.stdout).toBe(batch('d1', 'status'))
    expect(outcome.stderr).toBe('failed')
  })

  it('spends one wait budget across the batches it absorbs', async () => {
    const { calls, check, now } = replay(
      [succeeded(batch('d1', 'heartbeat')), succeeded(TIMED_OUT)],
      [0, 0, 600_000],
    )

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls.map((call) => call.timeoutMs)).toEqual([WAIT_MS, WAIT_MS - 600_000])
  })

  it('keeps a usable timeout once the budget is spent', async () => {
    const { calls, check, now } = replay(
      [succeeded(batch('d1', 'heartbeat')), succeeded(TIMED_OUT)],
      [0, 0, WAIT_MS + 5_000],
    )

    await waitOnRun({ run: 'run_x', check, now })

    expect(calls[1]?.timeoutMs).toBe(1_000)
  })
})

describe('checkArgs', () => {
  it('waits with no type filter', () => {
    expect(checkArgs('run_x', undefined, 5_000)).toEqual([
      'orchestration',
      'check',
      '--run',
      'run_x',
      '--wait',
      '--timeout-ms',
      '5000',
      '--json',
    ])
  })

  it('acknowledges through the same call', () => {
    expect(checkArgs('run_x', 'd1', 5_000)).toEqual([
      'orchestration',
      'check',
      '--run',
      'run_x',
      '--ack',
      'd1',
      '--wait',
      '--timeout-ms',
      '5000',
      '--json',
    ])
  })
})

describe('parseWaitArgs', () => {
  it('reads the Run and an optional delivery', () => {
    expect(parseWaitArgs(['--run', 'run_x'])).toEqual({ run: 'run_x', ack: undefined })
    expect(parseWaitArgs(['--run', 'run_x', '--ack', 'd1'])).toEqual({ run: 'run_x', ack: 'd1' })
  })

  it('requires a Run', () => {
    expect(() => parseWaitArgs(['--ack', 'd1'])).toThrow('--run')
  })

  it('refuses --types, which would let Orca type into the terminal', () => {
    expect(() => parseWaitArgs(['--run', 'run_x', '--types', 'question'])).toThrow('--types')
  })
})
