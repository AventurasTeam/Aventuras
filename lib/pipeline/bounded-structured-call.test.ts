import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type {
  CallRetryError,
  generateStructured,
  PromptSectionsInput,
  ResolveModelConfig,
} from '@/lib/ai'

import { boundedStructuredCall, type BoundedStructuredOutcome } from './bounded-structured-call'
import type { PhaseEmittedEvent } from './types'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, generateStructured: generateStructuredMock }
})

const schema = z.object({ answer: z.string() })
const PROMPT = { system: 'Answer in one word.', user: 'Which turn?' }
const OPTIONS = { actionId: 'act_1', defaultMaxOutput: 8_000 }

// Profile timeouts are seconds: lore-mgmt's bound is 45 000 ms.
const CONFIG: ResolveModelConfig = {
  providers: [
    {
      id: 'prov-1',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://x/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'prof-lore',
      kind: 'agent',
      name: 'Lore',
      modelRef: { providerId: 'prov-1', modelId: 'm' },
      timeout: 45,
    },
  ],
  assignments: { 'lore-mgmt': 'prof-lore' },
}

const PARSE_RETRY: CallRetryError = {
  tier: 'parse',
  detail: 'Unexpected end of JSON input',
  attempt: 1,
}
const NETWORK_RETRY: CallRetryError = { tier: 'provider', reason: 'network' }

async function run(signal: AbortSignal = new AbortController().signal): Promise<{
  events: PhaseEmittedEvent[]
  outcome: BoundedStructuredOutcome<{ answer: string }>
}> {
  const call = boundedStructuredCall({
    target: 'lore-mgmt',
    phaseName: 'boundary',
    prompt: PROMPT,
    schema,
    config: CONFIG,
    signal,
    options: OPTIONS,
  })
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const step = await call.next()
    if (step.done) return { events, outcome: step.value }
    events.push(step.value)
  }
}

// Answers `aborted` once the signal it was handed aborts, reporting the ms it waited.
function hangUntilAborted(recoverable: readonly CallRetryError[] = []): Promise<number> {
  return new Promise((reportElapsed) => {
    generateStructuredMock.mockImplementation(
      (...args: unknown[]) =>
        new Promise((resolve) => {
          const signal = args[4] as AbortSignal
          const startedAt = Date.now()
          const settle = () => {
            reportElapsed(Date.now() - startedAt)
            resolve({ status: 'aborted', recoverable })
          }
          if (signal.aborted) settle()
          else signal.addEventListener('abort', settle)
        }) as never,
    )
  })
}

beforeEach(() => {
  generateStructuredMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('boundedStructuredCall', () => {
  it('hands the call its target, prompt, schema, config and options, under a signal of its own', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { answer: 't2' },
      recoverable: [],
    })
    const outer = new AbortController().signal

    await run(outer)

    expect(generateStructuredMock).toHaveBeenCalledOnce()
    const [target, prompt, sentSchema, config, signal, options] =
      generateStructuredMock.mock.calls[0]!
    expect(target).toBe('lore-mgmt')
    expect(prompt).toBe(PROMPT)
    expect(sentSchema).toBe(schema)
    expect(config).toBe(CONFIG)
    expect(options).toEqual({ actionId: 'act_1', defaultMaxOutput: 8_000 })
    expect(signal).not.toBe(outer)
    expect(signal.aborted).toBe(false)
  })

  it('returns the value and the attempts it recovered from, one event per retried attempt', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { answer: 't2' },
      recoverable: [PARSE_RETRY],
    })

    expect(await run()).toEqual({
      events: [
        {
          type: 'recoverable_error',
          error: { kind: 'phase-logic', detail: 'Unexpected end of JSON input' },
        },
      ],
      outcome: { status: 'ok', value: { answer: 't2' }, recoverable: [PARSE_RETRY] },
    })
  })

  it('returns aborted on a cancel, after the events of the attempts it retried', async () => {
    void hangUntilAborted([NETWORK_RETRY])
    const controller = new AbortController()

    const pending = run(controller.signal)
    controller.abort()

    expect(await pending).toEqual({
      events: [{ type: 'recoverable_error', error: { kind: 'provider', reason: 'network' } }],
      outcome: { status: 'aborted' },
    })
  })

  it("fails an expiry as a provider timeout at the agent's bound, the abort kept as the cause", async () => {
    vi.useFakeTimers()
    const elapsed = hangUntilAborted()

    const pending = run()
    // Past every bound under test, so a wrong one still expires and the assertion names it.
    await vi.advanceTimersByTimeAsync(1_000_000)

    expect(await elapsed).toBe(45_000)
    expect(await pending).toEqual({
      events: [],
      outcome: {
        status: 'failed',
        error: { kind: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 45000ms' },
        lastError: 'timeout after 45000ms',
        cause: { status: 'aborted', recoverable: [] },
      },
    })
  })

  it('disarms its bound once the call settles', async () => {
    vi.useFakeTimers()
    generateStructuredMock.mockResolvedValue({
      status: 'ok',
      value: { answer: 't2' },
      recoverable: [],
    })

    await run()
    const signal = generateStructuredMock.mock.calls[0]![4]
    await vi.advanceTimersByTimeAsync(1_000_000)

    expect(signal.aborted).toBe(false)
  })

  it('disarms its bound when the call throws', async () => {
    vi.useFakeTimers()
    generateStructuredMock.mockRejectedValue(new Error('boom'))

    await expect(run()).rejects.toThrow('boom')
    const signal = generateStructuredMock.mock.calls[0]![4]
    await vi.advanceTimersByTimeAsync(1_000_000)

    expect(signal.aborted).toBe(false)
  })

  it('fails a call whose model does not resolve as a config fault at its phase', async () => {
    generateStructuredMock.mockResolvedValue({
      status: 'not-configured',
      kind: 'no-profile-assigned',
    })

    expect(await run()).toEqual({
      events: [],
      outcome: {
        status: 'failed',
        error: {
          kind: 'config-resolver',
          failure: 'no-profile-assigned',
          target: 'lore-mgmt',
          phaseName: 'boundary',
        },
        lastError: 'no-profile-assigned',
        cause: { status: 'not-configured', kind: 'no-profile-assigned' },
      },
    })
  })

  it("fails a failed call with the run's error, the bare cause and the raw failure", async () => {
    const failure: CallRetryError = {
      tier: 'parse',
      detail: 'end_entry_id must be one of the listed turns: t1, t2',
      attempt: 2,
    }
    generateStructuredMock.mockResolvedValue({
      status: 'failed',
      error: failure,
      recoverable: [PARSE_RETRY],
    })

    expect(await run()).toEqual({
      events: [
        {
          type: 'recoverable_error',
          error: { kind: 'phase-logic', detail: 'Unexpected end of JSON input' },
        },
      ],
      outcome: {
        status: 'failed',
        error: {
          kind: 'phase-logic',
          detail: 'end_entry_id must be one of the listed turns: t1, t2',
        },
        lastError: 'end_entry_id must be one of the listed turns: t1, t2',
        cause: { status: 'failed', error: failure, recoverable: [PARSE_RETRY] },
      },
    })
  })
})

describe('boundedStructuredCall options (checked by tsc)', () => {
  it("takes no prompt sections, whose counts its outcome doesn't carry", () => {
    const none = { named: [], unnamed: [] }
    const sections: PromptSectionsInput = { halves: { system: none, user: none } }
    const call = () =>
      boundedStructuredCall({
        target: 'lore-mgmt',
        phaseName: 'boundary',
        prompt: PROMPT,
        schema,
        config: CONFIG,
        signal: new AbortController().signal,
        // @ts-expect-error the outcome drops promptSections, so the sections would go uncounted
        options: { ...OPTIONS, sections },
      })
    expect(call).toBeTypeOf('function')
  })
})
