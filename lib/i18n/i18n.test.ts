import { describe, expect, it } from 'vitest'

import { i18n, t } from './i18n'

describe('lib/i18n', () => {
  it('initializes synchronously with the en common namespace', () => {
    expect(i18n.isInitialized).toBe(true)
    expect(i18n.language).toBe('en')
  })

  it('resolves a known recovery key', () => {
    expect(t('recovery.title')).toBe("Couldn't load settings")
  })

  it('returns the key for an unknown key (no null)', () => {
    // returnNull:false → missing keys fall back to the key string, never null.
    expect(t('recovery.does_not_exist' as never)).toBe('recovery.does_not_exist')
  })
})
