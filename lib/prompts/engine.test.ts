import { describe, expect, it } from 'vitest'

import { createEngine, renderWith, templateGlobals } from './engine'
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

// buildGenerationContext skips the query behind a variable this reports as
// unread, so a variable it misses is a silently empty one — no render error, a
// truncated prompt. The bundled templates all name their variables directly, so
// only a fixture covers the macro path.
describe('templateGlobals', () => {
  const globalsFor = (pack: Pack, templateId: string) => [
    ...templateGlobals(createEngine(pack), templateId),
  ]

  it('reports the variables a template reads directly', () => {
    const globals = globalsFor(
      {
        templates: {
          t: {
            group: 'generationContext',
            source: '{{ name }}{% if piggybackFires %}x{% endif %}',
          },
        },
        macros: {},
      },
      't',
    )
    expect(globals.toSorted()).toEqual(['name', 'piggybackFires'])
  })

  it('follows an include into a macro that reads a variable the template never names', () => {
    const globals = globalsFor(
      {
        templates: { t: { group: 'generationContext', source: "Hi {% include 'buffer' %}" } },
        macros: {
          buffer: {
            group: 'generationContext',
            source: '{% for e in entries %}{{ e.content }}{% endfor %}',
          },
        },
      },
      't',
    )
    expect(globals).toContain('entries')
  })

  it('follows a chain of includes', () => {
    const globals = globalsFor(
      {
        templates: { t: { group: 'generationContext', source: "{% include 'outer' %}" } },
        macros: {
          outer: { group: 'generationContext', source: "{% include 'inner' %}" },
          inner: { group: 'generationContext', source: '{{ sceneMetadata.summary }}' },
        },
      },
      't',
    )
    expect(globals).toContain('sceneMetadata')
  })

  it('excludes a name the template assigns itself', () => {
    const globals = globalsFor(
      {
        templates: {
          t: {
            group: 'generationContext',
            source: "{% assign lastTurns = 'x' %}{{ lastTurns }}{{ entries }}",
          },
        },
        macros: {},
      },
      't',
    )
    expect(globals).toEqual(['entries'])
  })
})
