import { describe, expect, it } from 'vitest'

import { matchesRailToggleShortcut } from './shortcut'

type KeyPress = Parameters<typeof matchesRailToggleShortcut>[0]

// A US-layout backslash with no modifiers; each case overrides what it presses.
function press(overrides: Partial<KeyPress>): KeyPress {
  return {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    key: '\\',
    code: 'Backslash',
    ...overrides,
  }
}

describe('matchesRailToggleShortcut', () => {
  it('accepts Ctrl+\\ and Cmd+\\', () => {
    expect(matchesRailToggleShortcut(press({ ctrlKey: true }))).toBe(true)
    expect(matchesRailToggleShortcut(press({ metaKey: true }))).toBe(true)
  })

  it('accepts the physical Backslash key on a layout that types another character there', () => {
    // German: the key in the US Backslash position types '#'; `\` itself needs AltGr.
    expect(matchesRailToggleShortcut(press({ ctrlKey: true, key: '#' }))).toBe(true)
  })

  it('accepts a backslash typed from another physical key', () => {
    // UK ISO: the key beside left Shift types '\'.
    expect(matchesRailToggleShortcut(press({ ctrlKey: true, code: 'IntlBackslash' }))).toBe(true)
  })

  it('rejects a backslash without Ctrl or Cmd', () => {
    expect(matchesRailToggleShortcut(press({}))).toBe(false)
  })

  it('rejects Ctrl+Shift+\\ and Ctrl+Alt+\\', () => {
    expect(matchesRailToggleShortcut(press({ ctrlKey: true, shiftKey: true, key: '|' }))).toBe(
      false,
    )
    expect(matchesRailToggleShortcut(press({ ctrlKey: true, altKey: true }))).toBe(false)
  })

  it('rejects AltGr typing a backslash, which browsers report as Ctrl+Alt', () => {
    // German AltGr+ß: text input in the composer, not the shortcut.
    expect(
      matchesRailToggleShortcut(press({ ctrlKey: true, altKey: true, key: '\\', code: 'Minus' })),
    ).toBe(false)
  })

  it('rejects Ctrl with another key', () => {
    expect(matchesRailToggleShortcut(press({ ctrlKey: true, key: 'z', code: 'KeyZ' }))).toBe(false)
  })
})
