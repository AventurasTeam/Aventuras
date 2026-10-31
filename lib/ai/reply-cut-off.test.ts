import type { FinishReason, LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'

import {
  describeReplyCutOff,
  isCutOff,
  ReplyCutOffError,
  replyCutOff,
  replyStopOf,
  type ReplyCutOffFailure,
  type ReplyCutOffInput,
} from './reply-cut-off'

function usage(outputTokens: number | undefined, reasoningTokens?: number): LanguageModelUsage {
  return {
    inputTokens: 1000,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens,
    outputTokenDetails: { textTokens: undefined, reasoningTokens },
    totalTokens: undefined,
  }
}

const BASE: ReplyCutOffInput = {
  usage: undefined,
  maxOutput: undefined,
  window: null,
  promptEstimate: null,
  providerId: 'prov-1',
  modelId: 'model-1',
}

describe('isCutOff', () => {
  it.each<[FinishReason | undefined, boolean]>([
    ['length', true],
    ['stop', false],
    ['content-filter', false],
    ['tool-calls', false],
    ['error', false],
    ['other', false],
    [undefined, false],
  ])('reads %s as cut off: %s', (finishReason, expected) => {
    expect(isCutOff(finishReason)).toBe(expected)
  })
})

describe('replyStopOf', () => {
  it.each<[FinishReason | undefined, string | undefined, string | null]>([
    ['length', 'length', 'length'],
    ['length', undefined, 'length'],
    ['content-filter', 'content_filter', 'content-filter'],
    ['content-filter', 'refusal', 'content-filter'],
    ['other', undefined, 'interrupted'],
    ['other', 'eos', null],
    ['stop', 'stop', null],
    ['stop', undefined, null],
    ['tool-calls', 'tool_calls', null],
    ['error', undefined, null],
    [undefined, undefined, null],
  ])('reads %s with raw %s as %s', (finishReason, raw, expected) => {
    expect(replyStopOf(finishReason, raw)).toBe(expected)
  })
})

describe('replyCutOff', () => {
  it.each(['interrupted', 'content-filter'] as const)(
    'takes %s as the cause, whatever the limits say',
    (stop) => {
      expect(replyCutOff({ ...BASE, stop, usage: usage(512), maxOutput: 512 }).cause).toBe(stop)
    },
  )

  it('works the cause out from the limits on a length stop', () => {
    const input = { ...BASE, stop: 'length', usage: usage(512), maxOutput: 512 } as const
    expect(replyCutOff(input).cause).toBe('max-output')
  })

  it('reads max-output when the output reached the profile limit', () => {
    expect(replyCutOff({ ...BASE, usage: usage(512), maxOutput: 512 })).toEqual({
      cause: 'max-output',
      outputTokens: 512,
      reasoningTokens: null,
      maxOutput: 512,
      window: null,
      providerId: 'prov-1',
      modelId: 'model-1',
    })
  })

  it('reads max-output when the output passed the limit', () => {
    expect(replyCutOff({ ...BASE, usage: usage(600), maxOutput: 512 }).cause).toBe('max-output')
  })

  it('reads max-output when the profile sets a limit and the provider reported no count', () => {
    const failure = replyCutOff({ ...BASE, usage: undefined, maxOutput: 512 })
    expect(failure.cause).toBe('max-output')
    expect(failure.outputTokens).toBeNull()
    expect(failure.reasoningTokens).toBeNull()
  })

  it('reads max-output when usage exists but carries no output count', () => {
    expect(replyCutOff({ ...BASE, usage: usage(undefined), maxOutput: 512 }).cause).toBe(
      'max-output',
    )
  })

  it('reads unknown when the output stayed under the profile limit and no window is known', () => {
    const failure = replyCutOff({ ...BASE, usage: usage(511), maxOutput: 512 })
    expect(failure.cause).toBe('unknown')
    expect(failure.maxOutput).toBe(512)
  })

  it('reads unknown when the profile sets no limit', () => {
    expect(replyCutOff({ ...BASE, usage: usage(4096) })).toEqual({
      cause: 'unknown',
      outputTokens: 4096,
      reasoningTokens: null,
      maxOutput: null,
      window: null,
      providerId: 'prov-1',
      modelId: 'model-1',
    })
  })

  it('counts reasoning inside the output, reporting how much went there', () => {
    const failure = replyCutOff({ ...BASE, usage: usage(512, 400), maxOutput: 512 })
    expect(failure.cause).toBe('max-output')
    expect(failure.reasoningTokens).toBe(400)
  })

  it('keeps a reported reasoning count of 0 as 0, not as absent', () => {
    expect(replyCutOff({ ...BASE, usage: usage(512, 0) }).reasoningTokens).toBe(0)
  })

  describe('the window branch', () => {
    it('reads window when the prompt estimate plus the output reach the window', () => {
      expect(
        replyCutOff({ ...BASE, usage: usage(1000), window: 8192, promptEstimate: 7192 }),
      ).toEqual({
        cause: 'window',
        outputTokens: 1000,
        reasoningTokens: null,
        maxOutput: null,
        window: 8192,
        providerId: 'prov-1',
        modelId: 'model-1',
      })
    })

    it('reads unknown when the prompt estimate plus the output fall short of the window', () => {
      expect(
        replyCutOff({ ...BASE, usage: usage(999), window: 8192, promptEstimate: 7192 }).cause,
      ).toBe('unknown')
    })

    it('reads an unreported output as 0 against the window', () => {
      expect(
        replyCutOff({ ...BASE, usage: undefined, window: 8192, promptEstimate: 8192 }).cause,
      ).toBe('window')
      expect(
        replyCutOff({ ...BASE, usage: undefined, window: 8192, promptEstimate: 8191 }).cause,
      ).toBe('unknown')
    })

    // A prompt that fills the window leaves no room for output.
    it('keeps a reported output of 0 as 0, so a full window outranks the profile limit', () => {
      const failure = replyCutOff({
        ...BASE,
        usage: usage(0),
        maxOutput: 512,
        window: 8192,
        promptEstimate: 8192,
      })
      expect(failure.outputTokens).toBe(0)
      expect(failure.cause).toBe('window')
    })

    it('needs both the window and the prompt estimate', () => {
      expect(replyCutOff({ ...BASE, usage: usage(9000), window: 8192 }).cause).toBe('unknown')
      expect(replyCutOff({ ...BASE, usage: usage(9000), promptEstimate: 8000 }).cause).toBe(
        'unknown',
      )
    })

    it('prefers max-output when both limits were reached', () => {
      expect(
        replyCutOff({
          ...BASE,
          usage: usage(512),
          maxOutput: 512,
          window: 8192,
          promptEstimate: 8000,
        }).cause,
      ).toBe('max-output')
    })
  })
})

const FAILURE: ReplyCutOffFailure = {
  cause: 'max-output',
  outputTokens: 512,
  reasoningTokens: 400,
  maxOutput: 512,
  window: null,
  providerId: 'prov-1',
  modelId: 'model-1',
}

describe('describeReplyCutOff', () => {
  it('names the cause, both counts, the profile limit, the model and the provider', () => {
    expect(describeReplyCutOff(FAILURE)).toBe(
      'reply cut off (max-output): 512 output tokens, 400 reasoning, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })

  it('says when no output count was reported and leaves out an absent reasoning count', () => {
    expect(describeReplyCutOff({ ...FAILURE, outputTokens: null, reasoningTokens: null })).toBe(
      'reply cut off (max-output): output tokens not reported, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })

  it('names the window for the window cause, and no limit for unknown', () => {
    expect(
      describeReplyCutOff({
        ...FAILURE,
        cause: 'window',
        reasoningTokens: null,
        maxOutput: null,
        window: 8192,
      }),
    ).toBe(
      'reply cut off (window): 512 output tokens, window 8192; model model-1 on provider prov-1',
    )
    expect(
      describeReplyCutOff({ ...FAILURE, cause: 'unknown', reasoningTokens: null, maxOutput: 600 }),
    ).toBe('reply cut off (unknown): 512 output tokens; model model-1 on provider prov-1')
  })

  it('leaves a known window out of a max-output line', () => {
    expect(describeReplyCutOff({ ...FAILURE, window: 8192 })).toBe(
      'reply cut off (max-output): 512 output tokens, 400 reasoning, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })

  it('leaves out a reasoning count of 0, which OpenAI-compatible reports when it has none', () => {
    expect(describeReplyCutOff({ ...FAILURE, reasoningTokens: 0 })).toBe(
      'reply cut off (max-output): 512 output tokens, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })
})

describe('ReplyCutOffError', () => {
  it('carries the failure, its description as the message', () => {
    const error = new ReplyCutOffError(FAILURE)
    expect(error).toBeInstanceOf(Error)
    expect(error.failure).toBe(FAILURE)
    expect(error.message).toBe(
      'reply cut off (max-output): 512 output tokens, 400 reasoning, max output 512; ' +
        'model model-1 on provider prov-1',
    )
    expect(error.name).toBe('ReplyCutOffError')
  })
})
