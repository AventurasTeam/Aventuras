import { describe, expect, it } from 'vitest'

import {
  describeContextWindow,
  describeReplyCutOff,
  type CallRetryError,
  type CapabilityHint,
  type ContextWindowFailure,
  type ReplyCutOffFailure,
} from '@/lib/ai'

import { pipelineErrorDetail, structuredCallFailure, toPipelineError } from './call-error'
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

const OVER: ContextWindowFailure = {
  detectedBy: 'check',
  estimate: 71_234,
  window: 65_536,
  windowSource: 'configured',
  providerId: 'prov-1',
  modelId: 'model-1',
}

const HINT: CapabilityHint = { capability: 'reasoning', matched: 'thinking' }

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

  // generation-pipeline.md → Fatal error categories: the phase copies the hint as it maps.
  it('copies a capability hint onto the provider PipelineError', () => {
    const e: CallRetryError = {
      tier: 'provider',
      reason: 'unknown',
      detail: 'thinking is not supported',
      possibleCapabilityMismatch: HINT,
    }
    expect(toPipelineError(e, 'classifier')).toEqual({
      kind: 'provider',
      reason: 'unknown',
      detail: 'thinking is not supported',
      possibleCapabilityMismatch: HINT,
    })
  })

  it('omits the hint key when the provider CallRetryError has none, or an undefined one', () => {
    const none: CallRetryError = { tier: 'provider', reason: 'unknown', detail: 'bad' }
    const undefinedHint: CallRetryError = { ...none, possibleCapabilityMismatch: undefined }
    expect('possibleCapabilityMismatch' in toPipelineError(none, 'classifier')).toBe(false)
    expect('possibleCapabilityMismatch' in toPipelineError(undefinedHint, 'classifier')).toBe(false)
  })

  it.each(['classifier', 'suggestion', 'wizard-assist'] as const)(
    'maps a context-window CallRetryError to the context-window kind for %s, every field kept',
    (target) => {
      const e: CallRetryError = { tier: 'context-window', ...OVER }
      expect(toPipelineError(e, target)).toEqual({ kind: 'context-window', target, ...OVER })
    },
  )

  it('keeps the provider message and an unknown window on a provider-detected overflow', () => {
    const failure: ContextWindowFailure = {
      ...OVER,
      detectedBy: 'provider',
      window: null,
      windowSource: 'unknown',
      detail: 'request (71834 tokens) exceeds the available context size (65536 tokens)',
    }
    expect(toPipelineError({ tier: 'context-window', ...failure }, 'classifier')).toEqual({
      kind: 'context-window',
      target: 'classifier',
      ...failure,
    })
  })

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

  it('describes a context-window failure as describeContextWindow does', () => {
    const detail = pipelineErrorDetail({ kind: 'context-window', target: 'classifier', ...OVER })
    expect(detail).toBe(describeContextWindow(OVER))
    expect(detail).toContain('model-1')
  })

  it('describes a reply-cut-off, naming its cause and numbers', () => {
    expect(pipelineErrorDetail({ kind: 'reply-cut-off', target: 'classifier', ...CUT })).toBe(
      'reply cut off (max-output): 512 output tokens, 300 reasoning, max output 512; ' +
        'model model-1 on provider prov-1',
    )
  })
})

// The close's metadata call: another agent and phase than the pass, which keeps 'classifier'.
describe('structuredCallFailure', () => {
  const CALL = { target: 'lore-mgmt', phaseName: 'metadata', timeoutMs: 45_000 } as const

  it('reads an abort that reached it as the bound expiring, naming the target', () => {
    expect(structuredCallFailure({ status: 'aborted', recoverable: [] }, CALL)).toEqual({
      lastError: 'timeout after 45000ms',
      error: { kind: 'provider', reason: 'timeout', detail: 'lore-mgmt: timeout after 45000ms' },
    })
  })

  it('maps an unresolved model to a config-resolver error for the target and phase', () => {
    expect(
      structuredCallFailure({ status: 'not-configured', kind: 'no-profile-assigned' }, CALL),
    ).toEqual({
      lastError: 'no-profile-assigned',
      error: {
        kind: 'config-resolver',
        failure: 'no-profile-assigned',
        target: 'lore-mgmt',
        phaseName: 'metadata',
      },
    })
  })

  it('maps a provider failure', () => {
    expect(
      structuredCallFailure(
        {
          status: 'failed',
          error: { tier: 'provider', reason: 'network', detail: '503' },
          recoverable: [],
        },
        CALL,
      ),
    ).toEqual({ lastError: '503', error: { kind: 'provider', reason: 'network', detail: '503' } })
  })

  it('maps a parse failure to phase-logic', () => {
    expect(
      structuredCallFailure(
        {
          status: 'failed',
          error: { tier: 'parse', detail: 'title: expected string', attempt: 2 },
          recoverable: [],
        },
        CALL,
      ),
    ).toEqual({
      lastError: 'title: expected string',
      error: { kind: 'phase-logic', detail: 'title: expected string' },
    })
  })

  it('maps a window refusal to context-window, carrying the target', () => {
    expect(
      structuredCallFailure(
        { status: 'failed', error: { tier: 'context-window', ...OVER }, recoverable: [] },
        CALL,
      ),
    ).toEqual({
      lastError: describeContextWindow(OVER),
      error: { kind: 'context-window', target: 'lore-mgmt', ...OVER },
    })
  })

  it('maps a cut-off reply to reply-cut-off, carrying the target', () => {
    expect(
      structuredCallFailure(
        { status: 'failed', error: { tier: 'reply-cut-off', ...CUT }, recoverable: [] },
        CALL,
      ),
    ).toEqual({
      lastError: describeReplyCutOff(CUT),
      error: { kind: 'reply-cut-off', target: 'lore-mgmt', ...CUT },
    })
  })
})
