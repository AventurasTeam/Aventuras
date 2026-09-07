import { describe, it, expect } from 'vitest'
import { Liquid } from 'liquidjs'
import { storyTemplates } from './narrative'

const engine = new Liquid()

const render = (content: string) =>
  engine.parseAndRender(content, {
    chapterSummaries: '<<CHAPTERS>>',
    storyTime: 'Year 1, Day 13',
    tieredContextBlock: '<<WORLDSTATE>>',
    styleGuidance: '<<STYLE>>',
    inlineImageMode: false,
    visualProseMode: false,
    protagonistName: 'Aria',
  })

describe.each(storyTemplates.map((t) => [t.id, t.content] as const))(
  '%s system prompt',
  (_id, content) => {
    it('puts the chapter summaries ahead of everything that changes each turn', async () => {
      // This ordering is the whole point, not a style choice. The summaries are the largest
      // stable block in the prompt -- byte-identical across turns on a measured run -- and
      // anything volatile in front of them invalidates them for prefix caching. Putting the
      // world-state block back on top would silently cost ~13k tokens of reprocessing every
      // turn, with nothing failing to show for it.
      const out = await render(content)

      expect(out.indexOf('<<CHAPTERS>>')).toBeGreaterThan(-1)
      expect(out.indexOf('<<CHAPTERS>>')).toBeLessThan(out.indexOf('[CURRENT STORY TIME]'))
      expect(out.indexOf('<<CHAPTERS>>')).toBeLessThan(out.indexOf('<<WORLDSTATE>>'))
      expect(out.indexOf('<<WORLDSTATE>>')).toBeLessThan(out.indexOf('<<STYLE>>'))
    })

    it('keeps the rules ahead of the summaries, since they never change at all', async () => {
      const out = await render(content)

      expect(out.indexOf('# Role')).toBeLessThan(out.indexOf('<<CHAPTERS>>'))
    })

    it('emits no template machinery into the prompt', async () => {
      const out = await render(content)

      expect(out).not.toMatch(/\{%|\{\{/)
      expect(out).not.toContain('byte-identical')
    })

    it('omits each optional block cleanly when it is empty', async () => {
      const out = await engine.parseAndRender(content, {
        chapterSummaries: '',
        storyTime: '',
        tieredContextBlock: '',
        styleGuidance: '',
        inlineImageMode: false,
        visualProseMode: false,
        protagonistName: 'Aria',
      })

      expect(out).not.toContain('[CURRENT STORY TIME]')
      // Deliberately not asserting on blank-line runs: the template carries a few from
      // before this change, and tightening them here would be churn unrelated to ordering.
    })
  },
)

describe.each(storyTemplates.map((t) => [t.id, t.content] as const))(
  '%s — absent optional blocks',
  (_id, content) => {
    it('omits every optional block when the variable is missing entirely, not just empty', async () => {
      // Not the same case as an empty string. Liquid reads an absent variable as nil, and
      // `nil != ''` is true -- so `{% if storyTime != '' %}` *passes* and prints a bare
      // `[CURRENT STORY TIME]` header with nothing under it. Any story without a time
      // tracker hit that. The guards only mean what they read as because
      // `NarrativeService.buildPrompts` seeds every one of these keys to ''.
      const out = await engine.parseAndRender(content, {
        inlineImageMode: false,
        visualProseMode: false,
        protagonistName: 'Aria',
      })

      expect(out).not.toContain('[CURRENT STORY TIME]')
      expect(out).not.toMatch(/\{%|\{\{/)
    })
  },
)

const userHalf = (id: string) => {
  const template = storyTemplates.find((t) => t.id === id)
  if (!template?.userContent) throw new Error(`${id} has no userContent`)
  return template.userContent
}

const renderUser = (
  id: string,
  narratorReinforcement: string | undefined,
  pov: string,
  tense: string,
) =>
  engine.parseAndRender(userHalf(id), {
    narratorReinforcement,
    pov,
    tense,
    protagonistName: 'Aria',
  })

describe.each(['adventure', 'creative-writing'])('%s user message', (id) => {
  const povs = ['first', 'second', 'third']

  it('emits no template machinery at any level', async () => {
    for (const level of ['full', 'minimal', 'none']) {
      for (const pov of povs) {
        for (const tense of ['present', 'past']) {
          expect(await renderUser(id, level, pov, tense)).not.toMatch(/\{%|\{\{/)
        }
      }
    }
  })

  it('renders nothing at none', async () => {
    // Whitespace, not '': a level with no branch of its own still leaves the line breaks
    // between the branches that did not match. `joinReinforcement` is what keeps that off
    // the message.
    for (const pov of povs) {
      expect((await renderUser(id, 'none', pov, 'present')).trim()).toBe('')
    }
  })

  it('renders something at full and minimal, and reaches every pov branch', async () => {
    const seen = new Set<string>()
    for (const pov of povs) {
      const full = await renderUser(id, 'full', pov, 'present')
      expect(full.length).toBeGreaterThan(0)
      seen.add(full)
    }
    expect(seen.size).toBe(povs.length)
    expect((await renderUser(id, 'minimal', povs[0], 'present')).length).toBeGreaterThan(0)
  })

  it('varies full with tense', async () => {
    for (const pov of povs) {
      const present = await renderUser(id, 'full', pov, 'present')
      const past = await renderUser(id, 'full', pov, 'past')
      expect(present).toContain('present tense')
      expect(past).toContain('past tense')
      expect(present).not.toBe(past)
    }
  })
})

// What the shipped `full` text must say, rather than the exact bytes it says it in. Pinning
// the wording would fight every edit to the templates, which are meant to be edited; these
// are the properties a reworded template still has to hold.
describe.each(['adventure', 'creative-writing'])('%s — full is complete for every pov', (id) => {
  it('names the point of view it was rendered for', async () => {
    for (const [pov, word] of [
      ['first', 'first person'],
      ['second', 'second person'],
      ['third', 'third person'],
    ]) {
      expect(await renderUser(id, 'full', pov, 'present')).toContain(word)
    }
  })

  it('leaves no unsubstituted variable name behind', async () => {
    // Not asserting the name is present: creative writing's third-person branch never needs
    // it, since it directs the writer rather than describing the protagonist.
    for (const pov of ['first', 'second', 'third']) {
      expect(await renderUser(id, 'full', pov, 'present')).not.toContain('protagonistName')
    }
  })

  it('leaves no dangling example where an assign did not resolve', async () => {
    // The adventure template builds its "I do X" example through {% assign %} inside a
    // nested {% case pov %}. A pov the inner case does not cover renders the example empty
    // and the line reads `-> "..."`, which nothing else here would catch.
    for (const pov of ['first', 'second', 'third']) {
      const out = await renderUser(id, 'full', pov, 'present')
      expect(out).not.toMatch(/->\s*"\.\.\."/)
      expect(out).not.toMatch(/->\s*""/)
    }
  })
})

describe('the agency rule is what the levels actually differ on', () => {
  const AGENCY = /NEVER write/

  it('adventure carries it at full and not below', async () => {
    expect(await renderUser('adventure', 'full', 'second', 'present')).toMatch(AGENCY)
    expect(await renderUser('adventure', 'minimal', 'second', 'present')).not.toMatch(AGENCY)
    expect(await renderUser('adventure', 'none', 'second', 'present')).not.toMatch(AGENCY)
  })

  it('creative writing never carries it, since the author controls every character', async () => {
    for (const level of ['full', 'minimal', 'none']) {
      expect(await renderUser('creative-writing', level, 'third', 'present')).not.toMatch(AGENCY)
    }
  })
})
