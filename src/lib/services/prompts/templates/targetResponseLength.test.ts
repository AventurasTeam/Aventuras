import { describe, it, expect } from 'vitest'
import {
  templateUsesTargetResponseLength,
  targetResponseLengthIsHonoured,
} from './targetResponseLength'

describe('templateUsesTargetResponseLength', () => {
  it('sees the length branched on in a conditional', () => {
    expect(
      templateUsesTargetResponseLength(`{% if targetResponseLength == 'short' %}x{% endif %}`),
    ).toBe(true)
    expect(
      templateUsesTargetResponseLength(
        `{% case targetResponseLength %}{% when 'long' %}x{% endcase %}`,
      ),
    ).toBe(true)
    expect(
      templateUsesTargetResponseLength(
        `{% unless targetResponseLength == 'dynamic' %}x{% endunless %}`,
      ),
    ).toBe(true)
  })

  it('sees the length emitted directly', () => {
    expect(templateUsesTargetResponseLength('{{ targetResponseLength }}')).toBe(true)
  })

  it('does not see the composed sentence the application used to supply', () => {
    expect(templateUsesTargetResponseLength('{{ lengthInstruction }}')).toBe(false)
  })

  it('does not see an absent template', () => {
    expect(templateUsesTargetResponseLength('')).toBe(false)
    expect(templateUsesTargetResponseLength(null)).toBe(false)
    expect(templateUsesTargetResponseLength(undefined)).toBe(false)
  })

  it('does not match the identifier as part of a longer word', () => {
    expect(templateUsesTargetResponseLength('{{ targetResponseLengthLabel }}')).toBe(false)
  })

  it('ignores a reference inside a comment block', () => {
    expect(
      templateUsesTargetResponseLength(
        `{% comment %}{% case targetResponseLength %}{% endcase %}{% endcomment %}`,
      ),
    ).toBe(false)
  })

  it('ignores a reference inside a raw block', () => {
    expect(
      templateUsesTargetResponseLength(`{% raw %}{{ targetResponseLength }}{% endraw %}`),
    ).toBe(false)
  })

  it('does not count assigning to the variable, which overwrites the setting', () => {
    expect(templateUsesTargetResponseLength(`{% assign targetResponseLength = 'short' %}`)).toBe(
      false,
    )
    expect(
      templateUsesTargetResponseLength(`{% capture targetResponseLength %}x{% endcapture %}`),
    ).toBe(false)
  })

  it('counts an assignment that reads the variable', () => {
    expect(templateUsesTargetResponseLength(`{% assign len = targetResponseLength %}`)).toBe(true)
  })

  it('ignores the name written as prose or quoted as a string', () => {
    expect(templateUsesTargetResponseLength('Set targetResponseLength to short.')).toBe(false)
    expect(templateUsesTargetResponseLength(`{{ "targetResponseLength" }}`)).toBe(false)
  })
})

describe('targetResponseLengthIsHonoured', () => {
  const BRANCHES = `{% case targetResponseLength %}{% when 'short' %}x{% endcase %}`
  const PLAIN = 'You are the narrator.'

  it('is honoured when only the turn message branches on it', () => {
    expect(
      targetResponseLengthIsHonoured({
        userTemplate: BRANCHES,
        systemTemplate: PLAIN,
        customSystemPrompt: undefined,
      }),
    ).toBe(true)
  })

  it('is honoured when only the system prompt carries it', () => {
    expect(
      targetResponseLengthIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: BRANCHES,
        customSystemPrompt: undefined,
      }),
    ).toBe(true)
  })

  it('is honoured when a custom system prompt ignores it but the turn message does not', () => {
    expect(
      targetResponseLengthIsHonoured({
        userTemplate: BRANCHES,
        systemTemplate: PLAIN,
        customSystemPrompt: PLAIN,
      }),
    ).toBe(true)
  })

  it('is not honoured when a custom system prompt still renders the former sentence', () => {
    expect(
      targetResponseLengthIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: BRANCHES,
        customSystemPrompt: '{{ lengthInstruction }}',
      }),
    ).toBe(false)
  })

  it('is not honoured when neither prompt references it', () => {
    expect(
      targetResponseLengthIsHonoured({
        userTemplate: PLAIN,
        systemTemplate: PLAIN,
        customSystemPrompt: undefined,
      }),
    ).toBe(false)
  })
})
