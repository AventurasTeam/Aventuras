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
