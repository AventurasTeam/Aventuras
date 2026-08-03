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
    expect(t('landing:list.welcomeBody')).toBe(
      'Create your first story to begin. Everything stays on this device.',
    )
    expect(t('reader:send')).toBe('Send')
    expect(t('settings:tabs.diagnostics')).toBe('Diagnostics')
    expect(t('settings:diagnosticsHub.comingSoon')).toBe('Diagnostics Hub — coming soon')
    expect(t('storySettings:title')).toBe('Story Settings')
    expect(t('storySettings:tabs.memory')).toBe('Memory')
    expect(t('storySettings:save.unsavedTitle')).toBe('Unsaved changes')
  })

  it('resolves the shared chrome keys from the common namespace', () => {
    expect(t('chrome.appSettings')).toBe('App Settings')
    expect(t('chrome.back')).toBe('Back')
  })

  it('resolves every custom color picker label and interpolation', () => {
    expect(t('colorPicker.customColor')).toBe('Custom color')
    expect(t('colorPicker.pickCustomColor')).toBe('Pick custom color')
    expect(t('colorPicker.customColorValue', { hex: '#123456' })).toBe('Custom color #123456')
    expect(t('colorPicker.hexColor')).toBe('Hex color')
    expect(t('colorPicker.invalidHex', { example: '#3b82f6' })).toBe(
      'Enter a hex color, e.g. #3b82f6',
    )
    expect(t('colorPicker.apply')).toBe('Apply')
  })

  it('resolves the principle-owned hard-gate reasons', () => {
    expect(t('generationGate.inFlight')).toBe('Generation is in flight. Cancel to edit.')
    expect(t('generationGate.chapterClose')).toBe('Chapter close in progress. Cancel to edit.')
  })
})
