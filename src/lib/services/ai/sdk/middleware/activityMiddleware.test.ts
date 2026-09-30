import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('$lib/stores/settings.svelte', () => ({
  settings: { apiSettings: { llmTimeoutMs: 60_000 } },
}))

import { ActivityRecorder, ATTEMPT_NUMBER } from '$lib/services/activity'
import { activityMiddleware, AttemptTracker } from './activityMiddleware'
import { retryOn429Middleware } from './retryMiddleware'

const rateLimited = () =>
  Object.assign(new Error('Too Many Requests'), { statusCode: 429, responseHeaders: {} })

/** A recorder with an open turn and a parent step, as a caller would have. */
function record() {
  const recorder = new ActivityRecorder()
  recorder.setReporting('tree')
  recorder.startTurn('entry')
  const parentId = recorder.startStep('Change detection', { isLLM: true })
  return { recorder, parentId, steps: () => recorder.snapshot()[0].steps.slice(1) }
}

/** The retry middleware around the activity middleware around `doGenerate`, as generate.ts chains them. */
function call(doGenerate: () => Promise<unknown>, tracker?: AttemptTracker) {
  const retry = retryOn429Middleware(tracker?.retryHooks) as any
  const inner = tracker ? (activityMiddleware(tracker) as any) : null
  return retry.wrapGenerate({
    doGenerate: () => (inner ? inner.wrapGenerate({ doGenerate, params: {} }) : doGenerate()),
    params: {},
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('activity middleware', () => {
  it('records nothing for a first-time success', async () => {
    const { recorder, parentId, steps } = record()

    await call(async () => ({ text: 'ok' }), new AttemptTracker(recorder, parentId))

    expect(steps()).toEqual([])
  })

  it('records three attempts and two waits for two 429s then a success', async () => {
    const { recorder, parentId, steps } = record()
    const doGenerate = vi
      .fn()
      .mockRejectedValueOnce(rateLimited())
      .mockRejectedValueOnce(rateLimited())
      .mockResolvedValueOnce({ text: 'ok' })

    const result = call(doGenerate, new AttemptTracker(recorder, parentId))
    await vi.advanceTimersByTimeAsync(40_000)
    await result

    expect(steps().map((s) => [s.label, s.status, s.parentId === parentId])).toEqual([
      ['Attempt 1', 'failed', true],
      ['Waiting to retry', 'done', true],
      ['Attempt 2', 'failed', true],
      ['Waiting to retry', 'done', true],
      ['Attempt 3', 'done', true],
    ])
    const [first, wait] = steps()
    expect(first.error).toBe('Too Many Requests')
    // The default backoff is 10s with ±10% jitter.
    expect(wait.detail).toMatch(/^(9|10|11)s backoff · retry 1 of 3$/)
  })

  it('records no attempt for a single failure, and rethrows the same error', async () => {
    const { recorder, parentId, steps } = record()
    const error = Object.assign(new Error('Unauthorized'), { statusCode: 401 })

    await expect(
      call(() => Promise.reject(error), new AttemptTracker(recorder, parentId)),
    ).rejects.toBe(error)
    expect(steps()).toEqual([])
  })

  it('records a retry the SDK makes, with no wait of its own', async () => {
    const { recorder, parentId, steps } = record()
    const tracker = new AttemptTracker(recorder, parentId)
    const inner = activityMiddleware(tracker) as any
    const through = (doGenerate: () => Promise<unknown>) =>
      inner.wrapGenerate({ doGenerate, params: {} })

    await expect(through(() => Promise.reject(new Error('502')))).rejects.toThrow()
    await through(async () => ({ text: 'ok' }))

    expect(steps().map((s) => [s.label, s.status])).toEqual([
      ['Attempt 1', 'failed'],
      ['Attempt 2', 'done'],
    ])
  })

  it('makes the same calls with and without a tracker', async () => {
    const run = async (withTracker: boolean) => {
      const { recorder, parentId } = record()
      const doGenerate = vi
        .fn()
        .mockRejectedValueOnce(rateLimited())
        .mockResolvedValueOnce({ text: 'ok' })
      const result = call(
        doGenerate,
        withTracker ? new AttemptTracker(recorder, parentId) : undefined,
      )
      await vi.advanceTimersByTimeAsync(20_000)
      return { value: await result, calls: doGenerate.mock.calls.length }
    }

    expect(await run(true)).toEqual(await run(false))
  })
})

describe('attempt numbering', () => {
  it('numbers each failed attempt on its error, counting across the whole request', async () => {
    const { recorder, parentId } = record()
    const errors = [rateLimited(), rateLimited(), rateLimited(), rateLimited()]
    let i = 0
    const doGenerate = vi.fn(() => Promise.reject(errors[i++]))

    const result = call(doGenerate, new AttemptTracker(recorder, parentId))
    const settled = expect(result).rejects.toBe(errors[3])
    await vi.advanceTimersByTimeAsync(70_000)
    await settled

    expect(errors.map((e) => (e as any)[ATTEMPT_NUMBER])).toEqual([1, 2, 3, 4])
  })
})
