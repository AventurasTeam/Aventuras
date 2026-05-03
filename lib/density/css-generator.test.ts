import { describe, expect, it } from 'vitest'
import { densityToCssBlock, densityToFullCss } from './css-generator'
import { DENSITY_TOKEN_KEYS, DENSITY_VALUES } from './types'

describe('densityToCssBlock', () => {
  it('emits a :root selector when requested', () => {
    const css = densityToCssBlock('regular', { selector: ':root' })
    expect(css).toMatch(/^:root \{/)
  })

  it('emits a [data-density="X"] selector for the auto case', () => {
    const css = densityToCssBlock('comfortable', { selector: 'auto' })
    expect(css).toMatch(/^\[data-density="comfortable"\] \{/)
  })

  it('includes every token for the requested density', () => {
    const css = densityToCssBlock('regular', { selector: 'auto' })
    for (const key of DENSITY_TOKEN_KEYS) {
      expect(css).toContain(`${key}:`)
    }
  })

  it('emits values matching the registry', () => {
    const css = densityToCssBlock('compact', { selector: ':root' })
    expect(css).toContain('--control-h-md: 40px;')
  })
})

describe('densityToFullCss', () => {
  it('starts with a :root block (compact baseline)', () => {
    const css = densityToFullCss()
    expect(css.split('\n\n')[0]).toMatch(/^:root \{/)
    expect(css).toContain('--control-h-md: 40px;')
  })

  it('contains one [data-density] block per density value', () => {
    const css = densityToFullCss()
    for (const density of DENSITY_VALUES) {
      expect(css).toContain(`[data-density="${density}"]`)
    }
  })
})
