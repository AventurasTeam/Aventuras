import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

const translateNarration = PROMPT_TEMPLATES.find((t) => t.id === 'translate-narration')!
const translateInput = PROMPT_TEMPLATES.find((t) => t.id === 'translate-input')!
const translateUI = PROMPT_TEMPLATES.find((t) => t.id === 'translate-ui')!
const translateSuggestions = PROMPT_TEMPLATES.find((t) => t.id === 'translate-suggestions')!
const translateActionChoices = PROMPT_TEMPLATES.find((t) => t.id === 'translate-action-choices')!
const translateWizardContent = PROMPT_TEMPLATES.find((t) => t.id === 'translate-wizard-content')!

describe('translate-narration template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateNarration.content, { targetLanguage: 'French' })
    expect(result).toContain('French')
  })

  it('renders content in userContent', () => {
    const result = templateEngine.render(translateNarration.userContent!, {
      content: 'The sun set.',
    })
    expect(result).toContain('The sun set.')
  })
})

describe('translate-input template', () => {
  it('renders sourceLanguage in system prompt', () => {
    const result = templateEngine.render(translateInput.content, { sourceLanguage: 'Japanese' })
    expect(result).toContain('Japanese')
  })

  it('renders content in userContent', () => {
    const result = templateEngine.render(translateInput.userContent!, { content: 'Hello world' })
    expect(result).toContain('Hello world')
  })
})

describe('translate-ui template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateUI.content, { targetLanguage: 'Spanish' })
    expect(result).toContain('Spanish')
  })

  it('passes JSON payload through unmangled', () => {
    const json = '[{"id":"loc1","text":"The Keep"}]'
    const result = templateEngine.render(translateUI.userContent!, { elementsJson: json })
    expect(result).toContain(json)
  })
})

describe('translate-suggestions template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateSuggestions.content, {
      targetLanguage: 'German',
    })
    expect(result).toContain('German')
  })

  it('passes JSON payload through unmangled', () => {
    const json = '[{"type":"action","text":"Draw sword"}]'
    const result = templateEngine.render(translateSuggestions.userContent!, {
      suggestionsJson: json,
    })
    expect(result).toContain(json)
  })
})

describe('translate-action-choices template', () => {
  it('renders targetLanguage in system prompt', () => {
    const result = templateEngine.render(translateActionChoices.content, {
      targetLanguage: 'Korean',
    })
    expect(result).toContain('Korean')
  })

  it('passes JSON payload through unmangled', () => {
    const json = '[{"type":"do","text":"Open the chest"}]'
    const result = templateEngine.render(translateActionChoices.userContent!, { choicesJson: json })
    expect(result).toContain(json)
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
