import { describe, expect, it } from 'vitest'

import { createEngine, renderWith, templateGlobals } from './engine'
import type { Pack } from './types'

const pack: Pack = {
  templates: {
    greet: {
      group: 'generationContext',
      system: '',
      user: 'Hi {{ name }}. {% include "footer" %}',
    },
  },
  macros: {
    footer: { group: 'staticContent', source: 'Bye.' },
  },
}

describe('engine', () => {
  it('renders a template synchronously, resolving includes from the in-memory map', () => {
    const engine = createEngine(pack)
    expect(renderWith(engine, 'greet', { name: 'Aria' }).user).toBe('Hi Aria. Bye.')
  })

  it('exposes registered custom filters', () => {
    const engine = createEngine({
      templates: {
        f: { group: 'generationContext', system: '', user: '{{ items | prose_join }}' },
      },
      macros: {},
    })
    expect(renderWith(engine, 'f', { items: ['a', 'b', 'c'] }).user).toBe('a, b, and c')
  })

  it('throws when a template and a macro share an id', () => {
    expect(() =>
      createEngine({
        templates: { dup: { group: 'generationContext', system: '', user: 'T' } },
        macros: { dup: { group: 'staticContent', source: 'M' } },
      }),
    ).toThrow(/id collision: 'dup'/)
  })

  it('throws when a macro id would replace a template half', () => {
    expect(() =>
      createEngine({
        templates: { t: { group: 'generationContext', system: '', user: 'T' } },
        macros: { 't#user': { group: 'staticContent', source: 'M' } },
      }),
    ).toThrow(/id collision: 't#user'/)
  })
})

// architecture.md → System and user halves: both halves render against one
// context, a blank system half is legal, a blank user half is a template error.
describe('template halves', () => {
  const halves: Pack = {
    templates: {
      both: {
        group: 'generationContext',
        system: 'You narrate for {{ name }}.',
        user: 'What does {{ name }} do? {% include "footer" %}',
      },
      systemInclude: {
        group: 'generationContext',
        system: 'Rules. {% include "footer" %}',
        user: 'Go.',
      },
      emptyUser: { group: 'generationContext', system: 'Rules.', user: '' },
      whitespaceUser: {
        group: 'generationContext',
        system: 'Rules.',
        user: '{% if never %}x{% endif %} \n ',
      },
      blankSystem: { group: 'generationContext', system: '', user: 'Go, {{ name }}.' },
    },
    macros: { footer: { group: 'staticContent', source: 'Bye.' } },
  }

  it('renders both halves against the same context', () => {
    expect(renderWith(createEngine(halves), 'both', { name: 'Aria' })).toEqual({
      system: 'You narrate for Aria.',
      user: 'What does Aria do? Bye.',
    })
  })

  it('resolves an include from the system half', () => {
    expect(renderWith(createEngine(halves), 'systemInclude', {}).system).toBe('Rules. Bye.')
  })

  it.each(['emptyUser', 'whitespaceUser'])(
    'throws, naming the template, when %s renders a blank user half',
    (templateId) => {
      expect(() => renderWith(createEngine(halves), templateId, {})).toThrow(
        `template '${templateId}' rendered a blank user half`,
      )
    },
  )

  it('renders a blank system half as an empty string', () => {
    expect(renderWith(createEngine(halves), 'blankSystem', { name: 'Aria' })).toEqual({
      system: '',
      user: 'Go, Aria.',
    })
  })
})

// buildGenerationContext skips the query behind a variable this reports as
// unread, so a variable it misses is a silently empty one — no render error, a
// truncated prompt. The bundled templates all name their variables directly, so
// only a fixture covers the macro path.
describe('templateGlobals', () => {
  const globalsFor = (source: string, macros: Pack['macros'] = {}) => [
    ...templateGlobals(
      createEngine({
        templates: { t: { group: 'generationContext', system: '', user: source } },
        macros,
      }),
      't',
    ),
  ]

  it('reports the variables a template reads directly', () => {
    expect(globalsFor('{{ name }}{% if piggybackFires %}x{% endif %}').toSorted()).toEqual([
      'name',
      'piggybackFires',
    ])
  })

  it('follows an include into a macro that reads a variable the template never names', () => {
    const globals = globalsFor("Hi {% include 'buffer' %}", {
      buffer: {
        group: 'generationContext',
        source: '{% for e in entries %}{{ e.content }}{% endfor %}',
      },
    })
    expect(globals).toContain('entries')
  })

  it('follows a chain of includes', () => {
    const globals = globalsFor("{% include 'outer' %}", {
      outer: { group: 'generationContext', source: "{% include 'inner' %}" },
      inner: { group: 'generationContext', source: '{{ sceneMetadata.summary }}' },
    })
    expect(globals).toContain('sceneMetadata')
  })

  it('excludes a name the template assigns itself', () => {
    expect(globalsFor("{% assign lastTurns = 'x' %}{{ lastTurns }}{{ entries }}")).toEqual([
      'entries',
    ])
  })

  // A half is asked for first: a union and a half memoized under one key would
  // hand the later union call the user half alone.
  it('unions both halves, and reports one half alone when asked', () => {
    const engine = createEngine({
      templates: {
        t: {
          group: 'generationContext',
          system: '{{ calendarVocabulary }}',
          user: '{% for e in entries %}{{ e.content }}{% endfor %}',
        },
      },
      macros: {},
    })

    expect([...templateGlobals(engine, 't', 'user')]).toEqual(['entries'])
    expect([...templateGlobals(engine, 't')].toSorted()).toEqual(['calendarVocabulary', 'entries'])
    expect([...templateGlobals(engine, 't', 'system')]).toEqual(['calendarVocabulary'])
  })
})
