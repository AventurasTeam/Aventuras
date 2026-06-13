import { describe, expect, it } from 'vitest'

import type { CallRetryError } from '@/lib/ai'

import { toPipelineError } from './call-error'

describe('toPipelineError', () => {
  it('maps a provider CallRetryError to a provider PipelineError', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'auth', detail: 'nope' }
    expect(toPipelineError(e)).toEqual({ kind: 'provider', reason: 'auth', detail: 'nope' })
  })

  it('omits detail when absent', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'timeout' }
    expect(toPipelineError(e)).toEqual({ kind: 'provider', reason: 'timeout' })
  })

  it('preserves an empty-string detail (only absent detail is omitted)', () => {
    const e: CallRetryError = { tier: 'provider', reason: 'auth', detail: '' }
    expect(toPipelineError(e)).toEqual({ kind: 'provider', reason: 'auth', detail: '' })
  })

  it('maps a parse CallRetryError to phase-logic', () => {
    const e: CallRetryError = { tier: 'parse', detail: 'bad json', attempt: 1 }
    expect(toPipelineError(e)).toEqual({ kind: 'phase-logic', detail: 'bad json' })
  })
})
