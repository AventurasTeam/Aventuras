import { describe, it, expect } from 'vitest'
import { narratorSettingAvailability } from './narratorSettingAvailability'
import { storyTemplates } from './narrative'

const LENGTH = `{% case targetResponseLength %}{% when 'short' %}x{% endcase %}`
const REINFORCEMENT = `{% if narratorReinforcement == 'full' %}x{% endif %}`
const PLAIN = 'You are the narrator.'

describe('narratorSettingAvailability', () => {
  it('reports both settings available on the shipped pack', () => {
    for (const template of storyTemplates) {
      expect(
        narratorSettingAvailability({
          userTemplate: template.userContent,
          systemTemplate: template.content,
          customSystemPrompt: undefined,
        }),
      ).toEqual({ targetResponseLength: undefined, narratorReinforcement: undefined })
    }
  })

  it('finds each setting in whichever half carries it', () => {
    expect(
      narratorSettingAvailability({
        userTemplate: LENGTH,
        systemTemplate: REINFORCEMENT,
        customSystemPrompt: undefined,
      }),
    ).toEqual({ targetResponseLength: undefined, narratorReinforcement: undefined })
  })

  it('reads a custom system prompt in place of the pack system half', () => {
    const result = narratorSettingAvailability({
      userTemplate: PLAIN,
      systemTemplate: LENGTH + REINFORCEMENT,
      customSystemPrompt: REINFORCEMENT,
    })
    expect(result.narratorReinforcement).toBeUndefined()
    expect(result.targetResponseLength).toContain('custom system prompt')
  })

  it('names the pack when no custom prompt is set', () => {
    const result = narratorSettingAvailability({
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
      narratorSettingAvailability({
        userTemplate: PLAIN,
        systemTemplate: '{{ lengthInstruction }}',
        customSystemPrompt: undefined,
      }).targetResponseLength,
    ).toBeDefined()
  })
})
