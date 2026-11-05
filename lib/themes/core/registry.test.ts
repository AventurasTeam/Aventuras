import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { themes } from './registry'
import { COLOR_SLOT_KEYS } from '../types'

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [number, number, number]
}

function composite(top: string, under: string, share: number): [number, number, number] {
  const a = channels(top)
  const b = channels(under)
  return a.map((c, i) => share * c + (1 - share) * b[i]) as [number, number, number]
}

// Björn Ottosson's OKLab, in floating point, from gamma-encoded sRGB channels in 0-1.
function oklab(rgb: readonly number[]): [number, number, number] {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function oklabDistance(a: number[], b: number[]): number {
  return 100 * Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

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
      if (theme.mode === 'dark') {
        expect(block, `${theme.id} landed share`).toContain(
          `--landed-tint-share: ${Math.round(theme.landedTintShare * 100)}%;`,
        )
      } else {
        expect(block, `${theme.id} has no landed share`).not.toContain('--landed-tint-share')
      }
    }
  })

  // The floor is how far default-light's tint stands out from its --bg-sunken; each dark theme's
  // landedTintShare is the smallest whole percent that lifts its fainter card kind to it.
  it("every dark theme landedTintShare is the smallest share that reaches default-light's floor", () => {
    const light = themes.find((t) => t.id === 'default-light')
    if (light === undefined) throw new Error('default-light is not in the registry')
    const floor = oklabDistance(
      oklab(channels(light.colors['--selection-bg'])),
      oklab(channels(light.colors['--bg-sunken'])),
    )
    for (const theme of themes) {
      if (theme.mode !== 'dark') continue
      const fainterAt = (share: number) =>
        Math.min(
          ...(['--bg-raised', '--bg-sunken'] as const).map((card) =>
            oklabDistance(
              oklab(composite(theme.colors['--selection-bg'], theme.colors[card], share)),
              oklab(channels(theme.colors[card])),
            ),
          ),
        )
      const percent = Math.round(theme.landedTintShare * 100)
      expect(fainterAt(percent / 100), `${theme.id} at ${percent}%`).toBeGreaterThanOrEqual(floor)
      expect(fainterAt((percent - 1) / 100), `${theme.id} at ${percent - 1}%`).toBeLessThan(floor)
    }
  })

  // A light theme paints its tint at full strength, so its --selection-bg alone must reach the floor.
  it("every light theme's tint reaches default-light's floor on both card kinds", () => {
    const light = themes.find((t) => t.id === 'default-light')
    if (light === undefined) throw new Error('default-light is not in the registry')
    const tint = (theme: (typeof themes)[number], card: '--bg-raised' | '--bg-sunken') =>
      oklabDistance(
        oklab(channels(theme.colors['--selection-bg'])),
        oklab(channels(theme.colors[card])),
      )
    const floor = tint(light, '--bg-sunken')
    for (const theme of themes) {
      if (theme.mode !== 'light') continue
      for (const card of ['--bg-raised', '--bg-sunken'] as const) {
        expect(tint(theme, card), `${theme.id} on ${card}`).toBeGreaterThanOrEqual(floor)
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
