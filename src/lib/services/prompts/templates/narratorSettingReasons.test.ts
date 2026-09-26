import { describe, it, expect } from 'vitest'
import {
  narratorSettingReasons,
  TARGET_RESPONSE_LENGTH_VAR,
  NARRATOR_REINFORCEMENT_VAR,
} from './narratorSettingReasons'
import { templateReferencesVariable } from './templateReferences'
import { storyTemplates } from './narrative'

const LENGTH = `{% case targetResponseLength %}{% when 'short' %}x{% endcase %}`
const REINFORCEMENT = `{% if narratorReinforcement == 'full' %}x{% endif %}`
const PLAIN = 'You are the narrator.'

describe('narratorSettingReasons', () => {
  it('reports both settings available on the shipped pack', () => {
    for (const template of storyTemplates) {
      expect(
        narratorSettingReasons({
          userTemplate: template.userContent,
          systemTemplate: template.content,
          customSystemPrompt: undefined,
        }),
      ).toEqual({ targetResponseLength: undefined, narratorReinforcement: undefined })
    }
  })

  it('finds each setting in whichever half carries it', () => {
    expect(
      narratorSettingReasons({
        userTemplate: LENGTH,
        systemTemplate: REINFORCEMENT,
        customSystemPrompt: undefined,
      }),
    ).toEqual({ targetResponseLength: undefined, narratorReinforcement: undefined })
  })

  it('reads a custom system prompt in place of the pack system half', () => {
    const result = narratorSettingReasons({
      userTemplate: PLAIN,
      systemTemplate: LENGTH + REINFORCEMENT,
      customSystemPrompt: REINFORCEMENT,
    })
    expect(result.narratorReinforcement).toBeUndefined()
    expect(result.targetResponseLength).toContain('custom system prompt')
  })

  it('names the pack when no custom prompt is set', () => {
    const result = narratorSettingReasons({
      userTemplate: PLAIN,
      systemTemplate: PLAIN,
      customSystemPrompt: undefined,
    })
    expect(result.targetResponseLength).toContain("prompt pack's narrator prompts")
    expect(result.targetResponseLength).toContain('{{ targetResponseLength }}')
    expect(result.narratorReinforcement).toContain('{{ narratorReinforcement }}')
  })

  it('does not count the former composed length variable', () => {
    expect(
      narratorSettingReasons({
        userTemplate: PLAIN,
        systemTemplate: '{{ lengthInstruction }}',
        customSystemPrompt: undefined,
      }).targetResponseLength,
    ).toBeDefined()
  })
})

// Where the shipped narrator templates carry each setting, so an edit that drops one fails here
// rather than silently disabling the control for every story on the built-in pack.
describe.each(storyTemplates.map((t) => [t.id, t] as const))(
  '%s shipped template',
  (_id, template) => {
    it('picks its length line in the system half', () => {
      expect(templateReferencesVariable(template.content, TARGET_RESPONSE_LENGTH_VAR)).toBe(true)
    })

    it('carries the reinforcement in the turn message, not the system half', () => {
      expect(templateReferencesVariable(template.userContent, NARRATOR_REINFORCEMENT_VAR)).toBe(
        true,
      )
      expect(templateReferencesVariable(template.content, NARRATOR_REINFORCEMENT_VAR)).toBe(false)
    })
  },
)
