import { describe, it, expect } from 'vitest'
import { isSendKey } from './sendKey'

function key(overrides: Partial<Parameters<typeof isSendKey>[0]> = {}) {
  return {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 13,
    ...overrides,
  }
}

describe('isSendKey', () => {
  it('sends on a plain Enter on desktop and keeps Shift+Enter for a newline', () => {
    expect(isSendKey(key(), 'desktop')).toBe(true)
    expect(isSendKey(key({ shiftKey: true }), 'desktop')).toBe(false)
  })

  it('sends on Shift+Enter on a non-iOS touch device', () => {
    expect(isSendKey(key(), 'touch')).toBe(false)
    expect(isSendKey(key({ shiftKey: true }), 'touch')).toBe(true)
  })

  it('never sends on Return on iOS, even with auto-capitalisation reporting Shift', () => {
    expect(isSendKey(key(), 'ios')).toBe(false)
    expect(isSendKey(key({ shiftKey: true }), 'ios')).toBe(false)
  })

  it('sends on Cmd or Ctrl+Enter everywhere', () => {
    for (const platform of ['desktop', 'touch', 'ios'] as const) {
      expect(isSendKey(key({ metaKey: true }), platform)).toBe(true)
      expect(isSendKey(key({ ctrlKey: true }), platform)).toBe(true)
    }
  })

  it('ignores the Enter that commits an IME composition', () => {
    expect(isSendKey(key({ isComposing: true }), 'desktop')).toBe(false)
    expect(isSendKey(key({ keyCode: 229 }), 'desktop')).toBe(false)
  })

  it('ignores other keys', () => {
    expect(isSendKey(key({ key: 'a' }), 'desktop')).toBe(false)
  })
})
