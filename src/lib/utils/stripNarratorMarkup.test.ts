import { describe, it, expect } from 'vitest'
import { stripNarratorMarkup } from './text'

describe('stripNarratorMarkup', () => {
  it('unwraps a heading rather than dropping it', () => {
    // The heading carries the hour and the place — the two scene fields the classifier fills.
    expect(stripNarratorMarkup('### Late Morning | The Grotto\n\nShe freezes.')).toBe(
      'Late Morning | The Grotto\n\nShe freezes.',
    )
  })

  it('unwraps a heading that is also bold', () => {
    expect(stripNarratorMarkup('### **Mid-Morning | The Grotto Pool**')).toBe(
      'Mid-Morning | The Grotto Pool',
    )
  })

  it('drops horizontal rules, which carry no text', () => {
    expect(stripNarratorMarkup('One.\n\n***\n\nTwo.\n\n---\n\nThree.\n\n___\n\nFour.')).toBe(
      'One.\n\nTwo.\n\nThree.\n\nFour.',
    )
  })

  it('unwraps a bold-only line', () => {
    expect(stripNarratorMarkup('One.\n\n**The Assessment**\n\nTwo.')).toBe(
      'One.\n\nThe Assessment\n\nTwo.',
    )
  })

  it('leaves bold inside a sentence alone', () => {
    expect(stripNarratorMarkup('She said **no** to the Empress.')).toBe(
      'She said **no** to the Empress.',
    )
  })

  it('collapses the gaps a dropped rule leaves behind', () => {
    expect(stripNarratorMarkup('# Title\n\n***\n\nProse.')).toBe('Title\n\nProse.')
  })

  it('leaves ordinary prose untouched', () => {
    const prose = 'Morvana snorts.\n\n"Boring," she says.'
    expect(stripNarratorMarkup(prose)).toBe(prose)
  })

  it('leaves a bullet alone, which is not a rule', () => {
    expect(stripNarratorMarkup('- a bullet')).toBe('- a bullet')
  })
})
