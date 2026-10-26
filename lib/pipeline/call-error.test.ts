import { describe, expect, it } from 'vitest'

import type { CallRetryError, ReplyCutOffFailure } from '@/lib/ai'

import { pipelineErrorDetail, toPipelineError } from './call-error'
import type { PipelineError } from './types'

const CUT: ReplyCutOffFailure = {
  cause: 'max-output',
  outputTokens: 512,
  reasoningTokens: 300,
  maxOutput: 512,
  window: null,
  providerId: 'prov-1',
  modelId: 'model-1',
}

describe('toPipelineError', () => {
  it('maps a provider CallRetryError to a provider PipelineError', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'auth', detail: 'nope' }
    expect(toPipelineError(e, 'classifier')).toEqual({
      kind: 'provider',
      reason: 'auth',
      detail: 'nope',
    })
  })

  it('omits detail when absent', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'timeout' }
    expect(toPipelineError(e, 'classifier')).toEqual({ kind: 'provider', reason: 'timeout' })
  })

  it('preserves an empty-string detail (only absent detail is omitted)', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'auth', detail: '' }
    expect(toPipelineError(e, 'classifier')).toEqual({
      kind: 'provider',
      reason: 'auth',
      detail: '',
    })
  })

  it('maps a parse CallRetryError to phase-logic', () => {
    const e: CallRetryError = { tier: 'parse', detail: 'bad json', attempt: 1 }
    expect(toPipelineError(e, 'suggestion')).toEqual({ kind: 'phase-logic', detail: 'bad json' })
  })

  // generation-pipeline.md → Fatal error categories: the kind carries the caller's target.
  it.each(['classifier', 'suggestion', 'wizard-assist'] as const)(
    'maps a reply-cut-off CallRetryError to the reply-cut-off kind for %s, every field kept',
    (target) => {
      const e: CallRetryError = { tier: 'reply-cut-off', ...CUT }
      expect(toPipelineError(e, target)).toEqual({ kind: 'reply-cut-off', target, ...CUT })
    },
  )

  it('keeps null counts and a window on a reply-cut-off', () => {
    const failure: ReplyCutOffFailure = {
      ...CUT,
      cause: 'window',
      outputTokens: null,
      reasoningTokens: null,
      maxOutput: null,
      window: 8192,
    }
    expect(toPipelineError({ tier: 'reply-cut-off', ...failure }, 'classifier')).toEqual({
      kind: 'reply-cut-off',
      target: 'classifier',
      ...failure,
    })
  })
})

describe('pipelineErrorDetail', () => {
  it.each<[string, PipelineError, string | undefined]>([
    ['provider with a detail', { kind: 'provider', reason: 'network', detail: '503' }, '503'],
    ['provider without one', { kind: 'provider', reason: 'timeout' }, undefined],
    ['phase-logic', { kind: 'phase-logic', detail: 'bad json' }, 'bad json'],
    ['action-layer', { kind: 'action-layer', detail: 'UNIQUE failed' }, 'UNIQUE failed'],
    [
      'orchestrator',
      { kind: 'orchestrator', detail: 'reverse-replay failed' },
      'reverse-replay failed',
    ],
    [
      'config-resolver with a detail',
      {
        kind: 'config-resolver',
        failure: 'profile-missing',
        target: 'narrative',
        phaseName: 'narrative',
        detail: 'profile p gone',
      },
      'profile p gone',
    ],
    [
      'config-resolver without one',
      {
        kind: 'config-resolver',
        failure: 'profile-missing',
        target: 'narrative',
        phaseName: 'narrative',
      },
      undefined,
    ],
    [
      'embedder',
      { kind: 'embedder', reason: 'call', detail: 'embed timed out', staleCount: 3 },
      'embed timed out',
    ],
  ])('returns the detail of %s', (_label, error, expected) => {
    expect(pipelineErrorDetail(error)).toBe(expected)
  })

  it('describes a reply-cut-off, naming its cause and numbers', () => {
    expect(pipelineErrorDetail({ kind: 'reply-cut-off', target: 'classifier', ...CUT })).toBe(
      'reply cut off (max-output): 512 output tokens, 300 reasoning, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })
})
