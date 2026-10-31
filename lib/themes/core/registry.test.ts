import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { themes } from './registry'
import { COLOR_SLOT_KEYS } from '../types'

describe('theme registry', () => {
  it('contains 10 themes', () => {
    expect(themes).toHaveLength(10)
  })

  it('has unique theme ids', () => {
    const ids = themes.map((t) => t.id)
    expect(new Set(ids).size).toBe(themes.length)
  })

  it('every theme defines every color slot', () => {
    for (const theme of themes) {
      for (const key of COLOR_SLOT_KEYS) {
        expect(theme.colors[key], `${theme.id} missing ${key}`).toBeDefined()
      }
    }
  })

  // global.css is hand-kept beside this file, and the web build reads only global.css.
  it('global.css carries every slot of every theme', () => {
    const css = readFileSync(join(process.cwd(), 'global.css'), 'utf8')
    for (const theme of themes) {
      const start = css.indexOf(`[data-theme='${theme.id}'] {`)
      expect(start, `${theme.id} has no block`).toBeGreaterThan(-1)
      const block = css.slice(start, css.indexOf('}', start))
      // Web builds the tints with color-mix, the registry's rgba being for native.
      for (const key of COLOR_SLOT_KEYS.filter((slot) => !slot.startsWith('--tint-'))) {
        expect(block, `${theme.id} ${key}`).toContain(`${key}: ${theme.colors[key]};`)
      }
    }
  })

  it('a semantic text slot differs from its fill only where the fill fails as text', () => {
    const moved = themes.flatMap((theme) =>
      (['success', 'warning', 'danger', 'info'] as const)
        .filter((slot) => theme.colors[`--${slot}-text`] !== theme.colors[`--${slot}`])
        .map((slot) => `${theme.id} ${slot}`),
    )
    expect(moved).toEqual([
      'default-light warning',
      'default-light danger',
      'catppuccin-latte success',
      'catppuccin-latte warning',
      'catppuccin-latte danger',
      'catppuccin-latte info',
      'catppuccin-mocha danger',
      'fallen-down danger',
      'aventuras danger',
    ])
  })

  it('every theme has a valid mode', () => {
    for (const theme of themes) {
      expect(['light', 'dark']).toContain(theme.mode)
    }
  })

  it('only default-light and default-dark are accent-overridable', () => {
    const overridable = themes.filter((t) => t.accentOverridable).map((t) => t.id)
    expect(overridable).toEqual(['default-light', 'default-dark'])
  })

  it('parchment and fallen-down are the only themes with font overrides', () => {
    const withFonts = themes.filter((t) => t.fonts).map((t) => t.id)
    expect(withFonts).toEqual(['parchment', 'fallen-down'])
  })
})
