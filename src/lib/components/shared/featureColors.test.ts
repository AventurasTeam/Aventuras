import { describe, expect, it } from 'vitest'
import { FEATURE_COLORS } from './featureColors'

describe('FEATURE_COLORS', () => {
  it('gives every tone one colour for light themes and one for dark', () => {
    for (const color of Object.values(FEATURE_COLORS)) {
      for (const classes of [color.text, color.hoverText, color.revealText, color.vars]) {
        const parts = classes.split(' ')
        expect(parts).toHaveLength(2)
        expect(parts[0].startsWith('dark:')).toBe(false)
        expect(parts[1].startsWith('dark:')).toBe(true)
      }
    }
  })

  it('names no tone after the theme palette', () => {
    expect(Object.keys(FEATURE_COLORS)).not.toContain('danger')
    expect(Object.keys(FEATURE_COLORS)).not.toContain('destructive')
  })

  const shades = (classes: string) => classes.match(/(amber|blue|red)-\d+/g) ?? []
  const step = (shade: string) => Number(shade.split('-')[1])

  it('uses the same shade for the text, the revealed hover and the wash of a tone', () => {
    for (const color of Object.values(FEATURE_COLORS)) {
      expect(shades(color.revealText)).toEqual(shades(color.text))
      expect(shades(color.vars)).toEqual(shades(color.text))
    }
  })

  it('darkens a coloured trigger one shade on hover, in both modes', () => {
    for (const color of Object.values(FEATURE_COLORS)) {
      const rest = shades(color.text).map(step)
      const hover = shades(color.hoverText).map(step)
      expect(hover).toEqual(rest.map((n) => n + 100))
    }
  })
})
