import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext } from '../../../../test/fixtures/promptContext'

const translateNarration = PROMPT_TEMPLATES.find((t) => t.id === 'translate-narration')!
const translateInput = PROMPT_TEMPLATES.find((t) => t.id === 'translate-input')!
const translateUI = PROMPT_TEMPLATES.find((t) => t.id === 'translate-ui')!
const translateSuggestions = PROMPT_TEMPLATES.find((t) => t.id === 'translate-suggestions')!
const translateActionChoices = PROMPT_TEMPLATES.find((t) => t.id === 'translate-action-choices')!
const translateWizardContent = PROMPT_TEMPLATES.find((t) => t.id === 'translate-wizard-content')!

describe('translate-narration template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateNarration.content, { ...promptContext })
    expect(result).toContain('French')
  })

  it('renders content in userContent', () => {
    const result = templateEngine.render(translateNarration.userContent!, { ...promptContext })
    expect(result).toContain('The gate opened slowly')
  })
})

describe('translate-input template', () => {
  it('renders sourceLanguage in system prompt', () => {
    const result = templateEngine.render(translateInput.content, { ...promptContext })
    expect(result).toContain('Japanese')
  })

  it('renders content in userContent', () => {
    const result = templateEngine.render(translateInput.userContent!, { ...promptContext })
    expect(result).toContain('I draw my sword and step forward')
  })
})

describe('translate-ui template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateUI.content, { ...promptContext })
    expect(result).toContain('French')
  })

  it('passes JSON payload through unmangled', () => {
    const result = templateEngine.render(translateUI.userContent!, { ...promptContext })
    expect(result).toContain('The Keep')
    expect(result).toContain('The Marketplace')
  })
})

describe('translate-suggestions template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateSuggestions.content, { ...promptContext })
    expect(result).toContain('French')
  })

  it('passes JSON payload through unmangled', () => {
    const result = templateEngine.render(translateSuggestions.userContent!, { ...promptContext })
    expect(result).toContain('Draw your sword and charge.')
    expect(result).toContain('Ask the guardian about the prophecy.')
  })
})

describe('translate-action-choices template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateActionChoices.content, { ...promptContext })
    expect(result).toContain('French')
  })

  it('passes JSON payload through unmangled', () => {
    const result = templateEngine.render(translateActionChoices.userContent!, { ...promptContext })
    expect(result).toContain('Open the ancient chest.')
    expect(result).toContain('Greet the stranger.')
  })
})

describe('translate-wizard-content template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateWizardContent.content, {
      targetLanguage: 'Italian',
    })
    expect(result).toContain('Italian')
  })

  it('renders content in userContent', () => {
    const result = templateEngine.render(translateWizardContent.userContent!, {
      content: 'A dark castle loomed.',
    })
    expect(result).toContain('A dark castle loomed.')
  })
})
