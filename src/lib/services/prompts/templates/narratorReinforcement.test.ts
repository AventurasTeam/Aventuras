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
