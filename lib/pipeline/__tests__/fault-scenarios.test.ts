import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getModel } from '@/lib/ai'
import { type StubScenario } from '@/lib/ai/stub/scenarios'
import {
  resetTemporaryProvidersForTests,
  setTemporaryProvidersForTests,
} from '@/lib/ai/stub/temporary-registry'
import { callWithRetry, type CallRetryError } from '@/lib/ai/transport/call-with-retry'
import { ProviderTimeoutError } from '@/lib/ai/transport/classify-provider-error'
import { getCurrentActionId, getDiagnosticsSnapshot } from '@/lib/diagnostics'
import {
  definePipeline,
  pipelineEventBus,
  runPipeline,
  type PhaseEmittedEvent,
  type PhaseFn,
  type PhaseResult,
  type PipelineError,
} from '@/lib/pipeline'
import { domain } from '@/lib/stores'

import { makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const
const STUB = {
  id: 'stub-1',
  type: 'stub' as const,
  displayName: 'Stub',
  apiKey: 'stub-key',
  favoriteModelIds: [] as string[],
}

function toPipelineError(e: CallRetryError): PipelineError {
  return e.tier === 'provider'
    ? { kind: 'provider', reason: e.reason, ...(e.detail ? { detail: e.detail } : {}) }
    : { kind: 'phase-logic', detail: e.detail }
}

type Parsed = { reply?: string; refusal?: boolean }

function stubPhase(scenario: StubScenario): PhaseFn {
  return async function* (): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
    const { abortSignal } = domain.getPerTurnContext()
    const model = getModel('stub-1', scenario)
    const treatRejectionAsTimeout = scenario === 'mid-stream-timeout'

    const callFn = async (signal: AbortSignal): Promise<string> => {
      try {
        const { text } = await generateText({ model, prompt: 'go', abortSignal: signal })
        return text
      } catch (e) {
        // The mid-stream-timeout stub rejects with a timeout-class error; surface it
        // as a retryable provider timeout. A true user cancel aborts `signal` instead.
        if (treatRejectionAsTimeout && !signal.aborted) throw new ProviderTimeoutError()
        throw e
      }
    }

    const res = await callWithRetry(callFn, (raw) => JSON.parse(raw) as Parsed, {
      maxProviderAttempts: 2,
      maxParseAttempts: 2,
      signal: abortSignal,
    })
    for (const e of res.recoverable) yield { type: 'recoverable_error', error: toPipelineError(e) }
    if (res.status === 'aborted') return { status: 'aborted' }
    if (res.status === 'failed') return { status: 'failed', error: toPipelineError(res.error) }
    if (res.result.refusal) {
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'model refused' } }
    }
    yield {
      type: 'delta_emitted',
      action: {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: 'entry_stub',
            branchId: 'b1',
            position: 1,
            kind: 'ai_reply',
            content: res.result.reply ?? '',
            createdAt: 1,
          },
        },
      },
    }
    return { status: 'completed' }
  }
}

function recoverableCount(): number {
  return getDiagnosticsSnapshot().logEntries.filter((e) => e.kind === 'pipeline.recoverable_error')
    .length
}

describe('stub fault scenarios', () => {
  beforeEach(() => {
    resetSingletons()
    setTemporaryProvidersForTests([STUB])
  })
  afterEach(() => {
    resetTemporaryProvidersForTests()
    resetSingletons()
  })

  it('happy → completed; the captured fetch carries the run actionId', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'stub', phases: [{ name: 'gen', run: stubPhase('happy') }], ...base })

    const result = await runPipeline('stub', ctx)

    expect(result.outcome).toBe('completed')
    const call = getDiagnosticsSnapshot().httpCalls.find((c) => c.source === 'provider:stub-1')
    expect(call?.actionId).toBe(result.actionId)
  })

  it('malformed JSON → failed via parse-retry with a recoverable event', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: 'stub',
      phases: [{ name: 'gen', run: stubPhase('malformed-json') }],
      ...base,
    })

    const result = await runPipeline('stub', ctx)

    expect(result.outcome).toBe('failed')
    expect(result.error?.kind).toBe('phase-logic')
    expect(recoverableCount()).toBe(1) // maxParseAttempts - 1
  })

  it('mid-stream timeout → failed via provider-retry with a recoverable event', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: 'stub',
      phases: [{ name: 'gen', run: stubPhase('mid-stream-timeout') }],
      ...base,
    })

    const result = await runPipeline('stub', ctx)

    expect(result.outcome).toBe('failed')
    expect(result.error).toMatchObject({ kind: 'provider', reason: 'timeout' })
    expect(recoverableCount()).toBe(1) // maxProviderAttempts - 1
  })

  it('refusal → failed with no retries', async () => {
    const { ctx } = await makeHarness()
    definePipeline({ kind: 'stub', phases: [{ name: 'gen', run: stubPhase('refusal') }], ...base })

    const result = await runPipeline('stub', ctx)

    expect(result.outcome).toBe('failed')
    expect(result.error).toMatchObject({ kind: 'phase-logic', detail: 'model refused' })
    expect(recoverableCount()).toBe(0)
  })

  it('user cancellation → aborted, ambient cleared', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: 'stub',
      phases: [{ name: 'gen', run: stubPhase('cancellation-respects') }],
      ...base,
    })
    const off = pipelineEventBus.subscribe('phase_start', (e) => {
      const run = domain.getTxState().runs.get(e.runId)
      run?.abortController.abort()
    })

    const result = await runPipeline('stub', ctx)
    off()

    expect(result.outcome).toBe('aborted')
    expect(getCurrentActionId()).toBeUndefined()
    expect(getDiagnosticsSnapshot().logEntries.some((e) => e.kind === 'pipeline.run_aborted')).toBe(
      true,
    )
  })
})
