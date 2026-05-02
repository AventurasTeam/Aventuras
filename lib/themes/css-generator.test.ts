import { describe, expect, it } from 'vitest'
import { themeToCssBlock, themesToFullCss } from './css-generator'
import { themes } from './registry'

describe('themeToCssBlock', () => {
  it('emits a selector for default-light theme', () => {
    const css = themeToCssBlock(themes[0], { selector: ':root' })
    expect(css).toContain(':root {')
    expect(css).toContain('--bg-base: #fdfdfd;')
    expect(css).toContain('--accent: #3b82f6;')
  })

  it('uses [data-theme] selector for non-default themes', () => {
    const block = themeToCssBlock(themes[1], { selector: 'auto' })
    expect(block).toContain('[data-theme="default-dark"]')
  })

  it('emits font overrides when present', () => {
    const themed: (typeof themes)[0] = {
      ...themes[0],
      id: 'parchment',
      fonts: { '--font-reading': '"Lora", serif' },
    }
    const block = themeToCssBlock(themed, { selector: 'auto' })
    expect(block).toContain('--font-reading: "Lora", serif;')
  })
})

describe('themesToFullCss', () => {
  it('starts with the @tailwind directives', () => {
    const css = themesToFullCss(themes)
    expect(css).toMatch(/^@tailwind base;\s*\n@tailwind components;\s*\n@tailwind utilities;/)
  })

  it('emits :root for the first theme and [data-theme] for the rest', () => {
    const css = themesToFullCss(themes)
    const rootMatches = css.match(/:root \{/g) ?? []
    const dataMatches = css.match(/\[data-theme="/g) ?? []
    expect(rootMatches.length).toBe(1)
    expect(dataMatches.length).toBe(themes.length - 1)
  })
})
