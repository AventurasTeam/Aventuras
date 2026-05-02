import { describe, expect, it } from 'vitest'
import { themes } from './registry'
import { COLOR_SLOT_KEYS } from './types'

describe('theme registry', () => {
  it('contains 10 themes', () => {
    expect(themes).toHaveLength(10)
  })

  it('has unique theme ids', () => {
    const ids = themes.map((t) => t.id)
    expect(new Set(ids).size).toBe(themes.length)
  })

  it('every theme defines all 25 color slots', () => {
    for (const theme of themes) {
      for (const key of COLOR_SLOT_KEYS) {
        expect(theme.colors[key], `${theme.id} missing ${key}`).toBeDefined()
      }
    }
  })

  it('every theme has a valid mode', () => {
    for (const theme of themes) {
      expect(['light', 'dark']).toContain(theme.mode)
    }
  })
})
