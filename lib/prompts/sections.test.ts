import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'

import { createEngine, renderWith, templateGlobals } from './engine'
import { __resetSectionWarnings } from './sections'
import type { HalfSections, Pack } from './types'

function packOf(user: string, macros: Pack['macros'] = {}, system = ''): Pack {
  return { templates: { t: { group: 'generationContext', system, user } }, macros }
}

function render(user: string, context: Record<string, unknown> = {}, macros?: Pack['macros']) {
  return renderWith(createEngine(packOf(user, macros)), 't', context, { sections: true })
}

// Every byte of the half lands in exactly one piece.
function lengthOf(half: HalfSections): number {
  return (
    half.named.reduce((n, s) => n + s.text.length, 0) +
    half.unnamed.reduce((n, text) => n + text.length, 0)
  )
}

beforeEach(() => {
  __resetSectionWarnings()
  vi.restoreAllMocks()
})

describe('section tag', () => {
  it('writes its body through unchanged and records it', () => {
    const tagged = render("A{% section 'lore' %}B {{ x }}{% endsection %}C", { x: 'y' })
    const plain = render('AB {{ x }}C', { x: 'y' })

    expect(tagged.user).toBe(plain.user)
    expect(tagged.sections.user.named).toEqual([{ id: 'lore', text: 'B y' }])
    expect(tagged.sections.user.unnamed).toEqual(['AC'])
    expect(lengthOf(tagged.sections.user)).toBe(tagged.user.length)
  })

  it('leaves the variables a template reads unchanged, through includes', () => {
    const macros: Pack['macros'] = {
      m: { group: 'staticContent', source: "{% section 'lore' %}{{ fromMacro }}{% endsection %}" },
    }
    const tagged = createEngine(
      packOf(
        "{% section 'history' %}{% for e in entries %}{{ e }}{% endfor %}{% include 'm' %}{% endsection %}",
        macros,
      ),
    )
    const plain = createEngine(
      packOf("{% for e in entries %}{{ e }}{% endfor %}{% include 'm' %}", macros),
    )

    expect([...templateGlobals(tagged, 't')].sort()).toEqual(
      [...templateGlobals(plain, 't')].sort(),
    )
    expect(templateGlobals(tagged, 't')).toContain('entries')
    expect(templateGlobals(tagged, 't')).toContain('fromMacro')
  })

  it('opens no scope: an assign inside a section holds after it', () => {
    const out = render("{% section 'scene' %}{% assign seen = 'yes' %}{% endsection %}[{{ seen }}]")

    expect(out.user).toBe('[yes]')
  })

  it('adds up a repeated id', () => {
    const out = render(
      "{% section 'threads' %}one{% endsection %}-{% section 'threads' %}two{% endsection %}",
    )

    expect(out.sections.user.named).toEqual([
      { id: 'threads', text: 'one' },
      { id: 'threads', text: 'two' },
    ])
    expect(out.sections.user.unnamed).toEqual(['-'])
  })

  it('gives nested text to the innermost section', () => {
    const out = render(
      "{% section 'scene' %}a{% if true %}{% section 'places' %}b{% endsection %}{% endif %}c{% endsection %}",
    )

    expect(out.user).toBe('abc')
    expect(out.sections.user.named).toEqual([
      { id: 'scene', text: 'ac' },
      { id: 'places', text: 'b' },
    ])
    expect(lengthOf(out.sections.user)).toBe(out.user.length)
  })

  it('records the sections of an included macro', () => {
    const out = render(
      "x{% include 'm' %}",
      {},
      {
        m: { group: 'staticContent', source: "{% section 'lore' %}L{% endsection %}" },
      },
    )

    expect(out.sections.user.named).toEqual([{ id: 'lore', text: 'L' }])
  })

  it('counts an unknown id as unnamed text and warns once per id', () => {
    const warn = vi.spyOn(logger, 'warn')
    const out = render(
      "{% section 'mystery' %}M{% endsection %}|{% section 'mystery' %}N{% endsection %}",
    )
    render("{% section 'mystery' %}again{% endsection %}")

    expect(out.sections.user.named).toEqual([])
    expect(out.sections.user.unnamed).toEqual(['|', 'M', 'N'])
    expect(
      warn.mock.calls.filter(([event]) => event === 'provider.prompt_section_unknown'),
    ).toEqual([['provider.prompt_section_unknown', { id: 'mystery' }]])
  })

  it('drops a section whose output never reached the prompt', () => {
    const out = render(
      "{% capture gone %}{% section 'lore' %}hidden{% endsection %}{% endcapture %}kept",
    )

    expect(out.user).toBe('kept')
    expect(out.sections.user.named).toEqual([])
    expect(lengthOf(out.sections.user)).toBe(out.user.length)
  })

  it('gives each half and each render its own collector', () => {
    const engine = createEngine(
      packOf(
        "{% section 'history' %}{{ n }}{% endsection %}",
        {},
        "{% section 'setup' %}S{% endsection %}",
      ),
    )
    const first = renderWith(engine, 't', { n: 1 }, { sections: true })
    const second = renderWith(engine, 't', { n: 2 }, { sections: true })

    expect(first.sections.system.named).toEqual([{ id: 'setup', text: 'S' }])
    expect(first.sections.user.named).toEqual([{ id: 'history', text: '1' }])
    expect(second.sections.user.named).toEqual([{ id: 'history', text: '2' }])
  })

  it('renders as a plain block without the sections option', () => {
    const engine = createEngine(packOf("a{% section 'lore' %}b{% endsection %}"))

    expect(renderWith(engine, 't', {})).toEqual({ system: '', user: 'ab' })
  })

  it('refuses a section without a quoted id, or with more after it', () => {
    expect(() => render('{% section lore %}x{% endsection %}')).toThrow(/quoted id/)
    expect(() => render("{% section 'lore' extra %}x{% endsection %}")).toThrow(
      /only its quoted id/,
    )
    expect(() => render("{% section 'lore' %}x")).toThrow(/not closed/)
  })
})
