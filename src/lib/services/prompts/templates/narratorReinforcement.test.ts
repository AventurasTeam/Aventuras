import { describe, it, expect } from 'vitest'
import {
  templateUsesNarratorReinforcement,
  narratorReinforcementIsHonoured,
} from './narratorReinforcement'
import { storyTemplates } from './narrative'

describe('templateUsesNarratorReinforcement', () => {
  it('sees the level branched on in a conditional', () => {
    expect(
      templateUsesNarratorReinforcement(`{% if narratorReinforcement == 'full' %}x{% endif %}`),
    ).toBe(true)
    expect(
      templateUsesNarratorReinforcement(
        `{% case narratorReinforcement %}{% when 'full' %}x{% endcase %}`,
      ),
    ).toBe(true)
    expect(
      templateUsesNarratorReinforcement(
        `{% unless narratorReinforcement == 'none' %}x{% endunless %}`,
      ),
    ).toBe(true)
  })

  it('sees the level emitted directly', () => {
    expect(templateUsesNarratorReinforcement('{{ narratorReinforcement }}')).toBe(true)
  })

  it('does not see an absent or unrelated template', () => {
    expect(templateUsesNarratorReinforcement('{{ lengthInstruction }}')).toBe(false)
    expect(templateUsesNarratorReinforcement('')).toBe(false)
    expect(templateUsesNarratorReinforcement(null)).toBe(false)
    expect(templateUsesNarratorReinforcement(undefined)).toBe(false)
  })

  it('does not match the identifier as part of a longer word', () => {
    expect(templateUsesNarratorReinforcement('{{ narratorReinforcementLevel }}')).toBe(false)
  })

  it('holds for the templates the application ships', () => {
    for (const template of storyTemplates) {
      expect(templateUsesNarratorReinforcement(template.userContent)).toBe(true)
    }
  })
})

// The precedence a turn actually uses. Checking the system half alone -- the shape the
// Response Length guard has, and the obvious thing to "simplify" this back to -- refuses the
// setting for a story whose turn message honours it perfectly well.
describe('narratorReinforcementIsHonoured', () => {
  const BRANCHES = `{% if narratorReinforcement == 'full' %}x{% endif %}`
  const PLAIN = 'You are the narrator.'

  it('is honoured when the turn message branches on it', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: BRANCHES,
        systemTemplate: PLAIN,
        customSystemPrompt: undefined,
      }),
    ).toBe(true)
  })

  it('is honoured when a custom system prompt ignores it but the turn message does not', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: BRANCHES,
        systemTemplate: PLAIN,
        customSystemPrompt: PLAIN,
      }),
    ).toBe(true)
  })

  it('is honoured when only the system prompt carries it', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: BRANCHES,
        customSystemPrompt: undefined,
      }),
    ).toBe(true)
  })

  it('is honoured when only a custom system prompt carries it', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: PLAIN,
        customSystemPrompt: BRANCHES,
      }),
    ).toBe(true)
  })

  it('is not honoured when neither prompt references it', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: PLAIN,
        customSystemPrompt: undefined,
      }),
    ).toBe(false)
  })

  it('ignores the pack system half that a custom system prompt has replaced', () => {
    expect(
      narratorReinforcementIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: BRANCHES,
        customSystemPrompt: PLAIN,
      }),
    ).toBe(false)
  })

  it('is honoured for a story on the shipped pack', () => {
    for (const template of storyTemplates) {
      expect(
        narratorReinforcementIsHonoured({
          userTemplate: template.userContent,
          systemTemplate: template.content,
          customSystemPrompt: undefined,
        }),
      ).toBe(true)
    }
  })
})

describe('templateUsesNarratorReinforcement — comments do not count', () => {
  it('ignores a reference inside a comment block', () => {
    expect(
      templateUsesNarratorReinforcement(
        `{% comment %}{% if narratorReinforcement == 'full' %}x{% endif %}{% endcomment %}`,
      ),
    ).toBe(false)
  })

  it('ignores a reference inside an inline comment', () => {
    expect(templateUsesNarratorReinforcement(`{% # narratorReinforcement was here %}`)).toBe(false)
  })

  it('ignores whitespace-controlled comment tags', () => {
    expect(
      templateUsesNarratorReinforcement(`{%- comment -%}narratorReinforcement{%- endcomment -%}`),
    ).toBe(false)
  })

  it('still sees an active branch alongside a commented one', () => {
    expect(
      templateUsesNarratorReinforcement(
        `{% comment %}narratorReinforcement{% endcomment %}{% if narratorReinforcement == 'full' %}x{% endif %}`,
      ),
    ).toBe(true)
  })

  it('does not swallow the template around a comment', () => {
    // The shipped adventure system prompt carries a {% comment %} block; stripping must not
    // take the rest of the template with it.
    const adventure = storyTemplates.find((t) => t.id === 'adventure')
    expect(adventure?.content).toContain('{% comment %}')
    expect(templateUsesNarratorReinforcement(adventure?.content)).toBe(false)
    expect(templateUsesNarratorReinforcement(adventure?.userContent)).toBe(true)
  })
})

describe('templateUsesNarratorReinforcement — prose does not count', () => {
  it('ignores the variable name written as prose', () => {
    expect(
      templateUsesNarratorReinforcement(
        'Your narratorReinforcement level decides how much this prompt repeats.',
      ),
    ).toBe(false)
  })

  it('ignores it inside a quoted mention in prose', () => {
    expect(templateUsesNarratorReinforcement('Set "narratorReinforcement" to none.')).toBe(false)
  })

  it('still sees a real branch alongside prose that names it', () => {
    expect(
      templateUsesNarratorReinforcement(
        `Docs: narratorReinforcement picks a level.{% if narratorReinforcement == 'full' %}x{% endif %}`,
      ),
    ).toBe(true)
  })

  it('sees it in a tag split across lines', () => {
    expect(
      templateUsesNarratorReinforcement(`{% if\n  narratorReinforcement == 'full'\n%}x{% endif %}`),
    ).toBe(true)
  })
})

describe('templateUsesNarratorReinforcement — unevaluated regions do not count', () => {
  it('ignores a reference inside a raw block', () => {
    expect(
      templateUsesNarratorReinforcement(
        `{% raw %}{% if narratorReinforcement == 'full' %}x{% endif %}{% endraw %}`,
      ),
    ).toBe(false)
  })

  it('ignores a reference inside a string literal', () => {
    expect(templateUsesNarratorReinforcement(`{% assign label = 'narratorReinforcement' %}`)).toBe(
      false,
    )
    expect(templateUsesNarratorReinforcement(`{{ "narratorReinforcement" }}`)).toBe(false)
  })

  it('still sees the variable in a tag that also carries a string literal', () => {
    expect(
      templateUsesNarratorReinforcement(`{% if narratorReinforcement == 'full' %}x{% endif %}`),
    ).toBe(true)
  })

  it('still sees a real branch outside a raw block', () => {
    expect(
      templateUsesNarratorReinforcement(
        `{% raw %}narratorReinforcement{% endraw %}{% if narratorReinforcement == 'none' %}x{% endif %}`,
      ),
    ).toBe(true)
  })

  it('holds for the templates the application ships', () => {
    for (const template of storyTemplates) {
      expect(templateUsesNarratorReinforcement(template.userContent)).toBe(true)
    }
  })
})
