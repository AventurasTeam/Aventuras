import { describe, expect, it } from 'vitest'
import { densityTokens } from './registry'
import { DENSITY_TOKEN_KEYS, DENSITY_VALUES } from './types'

describe('density registry', () => {
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
