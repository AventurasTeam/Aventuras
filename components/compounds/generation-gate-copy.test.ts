import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'

import { gateDisabledReason } from './generation-gate-copy'

describe('gateDisabledReason', () => {
  it('is available (undefined) when not blocked, whatever the reason argument', () => {
    expect(gateDisabledReason(false)).toBeUndefined()
    expect(gateDisabledReason(false, 'ignored while not blocked')).toBeUndefined()
  })

  it('returns the given reason when blocked', () => {
    expect(gateDisabledReason(true, 'Chapter close in progress. Cancel to edit.')).toBe(
      'Chapter close in progress. Cancel to edit.',
    )
  })

  it('falls back to the shared generation-gate text when blocked with no reason given', () => {
    expect(gateDisabledReason(true)).toBe(t('common:generationGate.inFlight'))
    expect(gateDisabledReason(true)).toBe('Generation is in flight. Cancel to edit.')
  })
})
