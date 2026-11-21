import { describe, expect, it } from 'vitest'

import { t } from '@/lib/i18n'

import { rerunDisabledReason } from './use-rerun-disabled-reason'

const GATE = 'Generation is in flight. Cancel to edit.'

describe('rerunDisabledReason', () => {
  it('names the run in flight over a close owed', () => {
    expect(rerunDisabledReason(GATE, true)).toBe(GATE)
    expect(rerunDisabledReason(GATE, false)).toBe(GATE)
  })

  it('asks for the open chapter to close first while a close is owed', () => {
    expect(rerunDisabledReason(undefined, true)).toBe(t('chapters:actions.closeOpenFirst'))
    expect(rerunDisabledReason(undefined, true)).toBe('Close the open chapter first.')
  })

  it('gives no reason when a re-run may start', () => {
    expect(rerunDisabledReason(undefined, false)).toBeUndefined()
  })
})
