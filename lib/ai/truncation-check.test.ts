import type { LanguageModelUsage } from 'ai'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest'

import { logger, type Logger } from '@/lib/diagnostics'

import {
  __resetTruncationCheck,
  checkInputTokens,
  configureTruncationNotice,
  type TruncationNotice,
} from './truncation-check'

function usage(inputTokens: number | undefined): LanguageModelUsage {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens: 10,
    outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    totalTokens: undefined,
  }
}

const CALL = { providerId: 'prov-1', modelId: 'model-1' }

let debug: MockInstance<Logger['debug']>
let warn: MockInstance<Logger['warn']>
let sink: Mock<(notice: TruncationNotice) => void>

beforeEach(() => {
  debug = vi.spyOn(logger, 'debug').mockImplementation(() => {})
  warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
  sink = vi.fn<(notice: TruncationNotice) => void>()
})

afterEach(() => {
  __resetTruncationCheck()
  vi.restoreAllMocks()
})

// architecture.md → Truncation cross-check.
describe('checkInputTokens', () => {
  it.each([
    ['no usage', undefined, 100],
    ['no input count', usage(undefined), 100],
    ['an input count of 0, as OpenAI-compatible reports a missing one', usage(0), 100],
    ['no estimate', usage(10), null],
    ['an estimate of 0', usage(10), 0],
    ['a NaN estimate', usage(10), NaN],
    ['an infinite estimate', usage(10), Infinity],
    ['a NaN input count', usage(NaN), 100],
    ['an infinite input count', usage(Infinity), 100],
  ])('skips a call with %s', (_label, callUsage, estimate) => {
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: callUsage, estimate })
    expect(debug).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
  })

  it('logs the ratio at debug on every call it reads', () => {
    checkInputTokens({ ...CALL, usage: usage(120), estimate: 100 })
    checkInputTokens({ ...CALL, usage: usage(95), estimate: 100 })
    expect(debug.mock.calls).toEqual([
      ['provider.input_ratio', { ...CALL, estimate: 100, reported: 120, ratio: 1.2 }, undefined],
      ['provider.input_ratio', { ...CALL, estimate: 100, reported: 95, ratio: 0.95 }, undefined],
    ])
  })

  it('warns and notifies below the threshold', () => {
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: usage(49), estimate: 100 })
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      'provider.prompt_truncation_suspected',
      { ...CALL, estimate: 100, reported: 49, ratio: 0.49 },
      undefined,
    )
    expect(sink).toHaveBeenCalledExactlyOnceWith({ ...CALL, reported: 49, estimate: 100 })
  })

  it.each([
    ['exactly at the threshold', 50],
    ['above it', 120],
  ])('neither warns nor notifies %s', (_label, reported) => {
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: usage(reported), estimate: 100 })
    expect(warn).not.toHaveBeenCalled()
    expect(sink).not.toHaveBeenCalled()
  })

  it('warns on every detection but notifies once per model', () => {
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    checkInputTokens({ ...CALL, usage: usage(20), estimate: 100 })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('notifies again for another model, on the same provider or another', () => {
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    checkInputTokens({ ...CALL, modelId: 'model-2', usage: usage(10), estimate: 100 })
    checkInputTokens({ ...CALL, providerId: 'prov-2', usage: usage(10), estimate: 100 })
    expect(sink.mock.calls.map(([notice]) => [notice.providerId, notice.modelId])).toEqual([
      ['prov-1', 'model-1'],
      ['prov-1', 'model-2'],
      ['prov-2', 'model-1'],
    ])
  })

  it('spends the once on a detection with no notice configured', () => {
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    configureTruncationNotice(sink)
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(sink).not.toHaveBeenCalled()
  })

  it('stops notifying once the notice is cleared', () => {
    configureTruncationNotice(sink)
    configureTruncationNotice(null)
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    expect(sink).not.toHaveBeenCalled()
  })

  it('catches a throwing notice and logs it, so the call that reported is unaffected', () => {
    configureTruncationNotice(() => {
      throw new Error('toast host gone')
    })
    expect(() => checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })).not.toThrow()
    expect(warn).toHaveBeenCalledWith(
      'provider.truncation_notice_failed',
      { ...CALL, error: 'toast host gone' },
      undefined,
    )
  })

  it('spends the once on a notice that threw', () => {
    const throwing = vi.fn<(notice: TruncationNotice) => void>(() => {
      throw new Error('toast host gone')
    })
    configureTruncationNotice(throwing)
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100 })
    expect(throwing).toHaveBeenCalledOnce()
    expect(
      warn.mock.calls.filter(([kind]) => kind === 'provider.truncation_notice_failed'),
    ).toHaveLength(1)
  })

  it("attributes both logs to the call's action", () => {
    checkInputTokens({ ...CALL, usage: usage(10), estimate: 100, actionId: 'act_1' })
    expect(debug).toHaveBeenCalledWith('provider.input_ratio', expect.anything(), {
      actionId: 'act_1',
    })
    expect(warn).toHaveBeenCalledWith('provider.prompt_truncation_suspected', expect.anything(), {
      actionId: 'act_1',
    })
  })
})
