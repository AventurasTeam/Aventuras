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

  it('resolves per-screen namespace keys via the ns:key form', () => {
    expect(t('landing:emptyBody')).toBe('Stories will appear here once created.')
    expect(t('reader:send')).toBe('Send')
    expect(t('settings:tabs.diagnostics')).toBe('Diagnostics')
    expect(t('settings:diagnosticsHub.comingSoon')).toBe('Diagnostics Hub — coming soon')
  })

  it('resolves the shared chrome keys from the common namespace', () => {
    expect(t('chrome.appSettings')).toBe('App Settings')
    expect(t('chrome.back')).toBe('Back')
  })
})
