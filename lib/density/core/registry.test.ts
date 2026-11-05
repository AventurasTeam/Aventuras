import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { densityTokens } from './registry'
import { DENSITY_TOKEN_KEYS, DENSITY_VALUES, type DensityValue } from '../types'

function cssBlock(css: string, start: number): string {
  return css.slice(start, css.indexOf('}', start))
}

describe('density registry', () => {
  // global.css is hand-kept, and the web build reads only global.css; :root boots as compact.
  it('global.css carries every slot of every density', () => {
    const css = readFileSync(join(process.cwd(), 'global.css'), 'utf8')
    const rootStart = [...css.matchAll(/:root \{/g)]
      .map((match) => match.index)
      .find((start) => cssBlock(css, start).includes('--control-h-'))
    expect(rootStart, 'no :root density block').toBeDefined()
    const blocks: [string, string, DensityValue][] = [
      [':root', cssBlock(css, rootStart ?? 0), 'compact'],
      ...DENSITY_VALUES.map((density): [string, string, DensityValue] => {
        const start = css.indexOf(`[data-density='${density}'] {`)
        expect(start, `${density} has no block`).toBeGreaterThan(-1)
        return [density, cssBlock(css, start), density]
      }),
    ]
    for (const [name, block, density] of blocks) {
      for (const key of DENSITY_TOKEN_KEYS) {
        expect(block, `${name} ${key}`).toContain(`${key}: ${densityTokens[density][key]};`)
      }
    }
  })

  it('contains all three density values', () => {
    expect(Object.keys(densityTokens).sort()).toEqual([...DENSITY_VALUES].sort())
  })

  it('every density defines all sizing tokens', () => {
    for (const density of DENSITY_VALUES) {
      for (const key of DENSITY_TOKEN_KEYS) {
        expect(densityTokens[density][key], `${density} missing ${key}`).toBeDefined()
      }
    }
  })

  it('emits px-suffixed values', () => {
    for (const density of DENSITY_VALUES) {
      for (const key of DENSITY_TOKEN_KEYS) {
        expect(densityTokens[density][key]).toMatch(/^\d+px$/)
      }
    }
  })

  it('control-h-md ramps compact 40 → regular 44 → comfortable 48 (HIG-anchored)', () => {
    expect(densityTokens.compact['--control-h-md']).toBe('40px')
    expect(densityTokens.regular['--control-h-md']).toBe('44px')
    expect(densityTokens.comfortable['--control-h-md']).toBe('48px')
  })

  it('bar-h-md ramps compact 48 → regular 56 → comfortable 64 (above the tap floor)', () => {
    expect(densityTokens.compact['--bar-h-md']).toBe('48px')
    expect(densityTokens.regular['--bar-h-md']).toBe('56px')
    expect(densityTokens.comfortable['--bar-h-md']).toBe('64px')
  })

  it('bar-h-md sits above control-h-md at every density (structural, not a tap target)', () => {
    for (const density of DENSITY_VALUES) {
      const bar = parseInt(densityTokens[density]['--bar-h-md'], 10)
      const control = parseInt(densityTokens[density]['--control-h-md'], 10)
      expect(bar, `${density}: bar should clear the control floor`).toBeGreaterThan(control)
    }
  })

  it('control-h ramp is monotonic across densities at every size step', () => {
    for (const size of ['xs', 'sm', 'md', 'lg'] as const) {
      const key = `--control-h-${size}` as const
      const compact = parseInt(densityTokens.compact[key], 10)
      const regular = parseInt(densityTokens.regular[key], 10)
      const comfortable = parseInt(densityTokens.comfortable[key], 10)
      expect(compact, `${key} compact < regular`).toBeLessThan(regular)
      expect(regular, `${key} regular < comfortable`).toBeLessThan(comfortable)
    }
  })
})
