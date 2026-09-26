import { describe, it, expect } from 'vitest'
import { templateReferencesVariable, variableIsHonoured } from './templateReferences'

const uses = (content: string | null | undefined) => templateReferencesVariable(content, 'level')

describe('templateReferencesVariable', () => {
  it('sees the variable branched on or emitted', () => {
    expect(uses(`{% if level == 'full' %}x{% endif %}`)).toBe(true)
    expect(uses(`{% case level %}{% when 'full' %}x{% endcase %}`)).toBe(true)
    expect(uses(`{% unless level == 'none' %}x{% endunless %}`)).toBe(true)
    expect(uses(`{%- case level -%}{%- when 'full' -%}x{%- endcase -%}`)).toBe(true)
    expect(uses('{{ level }}')).toBe(true)
    expect(uses(`{% if\n  level == 'full'\n%}x{% endif %}`)).toBe(true)
  })

  it('does not see an absent template or another variable', () => {
    expect(uses('')).toBe(false)
    expect(uses(null)).toBe(false)
    expect(uses(undefined)).toBe(false)
    expect(uses('{{ other }}')).toBe(false)
    expect(uses('{{ levelLabel }}')).toBe(false)
  })

  it('ignores what Liquid never evaluates', () => {
    expect(uses(`{% comment %}{% if level %}x{% endif %}{% endcomment %}`)).toBe(false)
    expect(uses(`{%- comment -%}level{%- endcomment -%}`)).toBe(false)
    expect(uses(`{% # level was here %}`)).toBe(false)
    expect(uses(`{% raw %}{{ level }}{% endraw %}`)).toBe(false)
    expect(uses('Your level decides how much this prompt repeats.')).toBe(false)
    expect(uses(`{{ "level" }}`)).toBe(false)
    expect(uses(`{% assign label = 'level' %}`)).toBe(false)
  })

  it('still sees a live reference beside an unevaluated one', () => {
    expect(uses(`{% comment %}level{% endcomment %}{% if level %}x{% endif %}`)).toBe(true)
    expect(uses(`{% raw %}level{% endraw %}{% if level == 'none' %}x{% endif %}`)).toBe(true)
    expect(uses(`Docs: level picks one.{% if level == 'full' %}x{% endif %}`)).toBe(true)
  })

  it('does not count a name the setting does not reach', () => {
    expect(uses('{{ story.level }}')).toBe(false)
    expect(uses('{{ level-x }}')).toBe(false)
    expect(uses('{% increment level %}')).toBe(false)
  })

  it('does not count writing to the variable, only reading it', () => {
    expect(uses(`{% assign level = 'full' %}`)).toBe(false)
    expect(uses(`{% capture level %}x{% endcapture %}`)).toBe(false)
    expect(uses("{% liquid\n  assign level = 'x'\n%}")).toBe(false)
    expect(uses('{% assign copy = level %}')).toBe(true)
  })

  it('counts a read after a conditional assignment, which may not run', () => {
    expect(uses(`{% if x %}{% assign level = 'full' %}{% endif %}{{ level }}`)).toBe(true)
  })

  it('counts a template that does not parse, so the setting is not disabled on a guess', () => {
    expect(uses('{% if %}')).toBe(true)
  })
})

// The precedence a turn actually uses: the turn message always comes from the pack, and a
// custom system prompt replaces only the pack's system half.
describe('variableIsHonoured', () => {
  const READS = `{% if level == 'full' %}x{% endif %}`
  const PLAIN = 'You are the narrator.'
  const honoured = (userTemplate: string, systemTemplate: string, customSystemPrompt?: string) =>
    variableIsHonoured('level', { userTemplate, systemTemplate, customSystemPrompt })

  it('is honoured when either half reads it', () => {
    expect(honoured(READS, PLAIN)).toBe(true)
    expect(honoured(PLAIN, READS)).toBe(true)
  })

  it('reads a custom system prompt in place of the pack system half', () => {
    expect(honoured(PLAIN, PLAIN, READS)).toBe(true)
    expect(honoured(PLAIN, READS, PLAIN)).toBe(false)
  })

  it('counts the turn message whatever the custom system prompt says', () => {
    expect(honoured(READS, PLAIN, PLAIN)).toBe(true)
  })

  it('is not honoured when neither prompt reads it', () => {
    expect(honoured(PLAIN, PLAIN)).toBe(false)
  })
})
