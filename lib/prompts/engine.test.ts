import { describe, expect, it } from 'vitest'

import { createEngine, renderWith } from './engine'
import type { Pack } from './types'

const pack: Pack = {
  templates: {
    greet: { group: 'generationContext', source: 'Hi {{ name }}. {% include "footer" %}' },
  },
  macros: {
    footer: { group: 'staticContent', source: 'Bye.' },
  },
}

describe('engine', () => {
  it('renders a template synchronously, resolving includes from the in-memory map', () => {
    const engine = createEngine(pack)
    expect(renderWith(engine, 'greet', { name: 'Aria' })).toBe('Hi Aria. Bye.')
  })

  it('exposes registered custom filters', () => {
    const engine = createEngine({
      templates: { f: { group: 'generationContext', source: '{{ items | prose_join }}' } },
      macros: {},
    })
    expect(renderWith(engine, 'f', { items: ['a', 'b', 'c'] })).toBe('a, b, and c')
  })

  it('throws when a template and a macro share an id', () => {
    expect(() =>
      createEngine({
        templates: { dup: { group: 'generationContext', source: 'T' } },
        macros: { dup: { group: 'staticContent', source: 'M' } },
      }),
    ).toThrow(/id collision: 'dup'/)
  })
})
