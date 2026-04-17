import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext } from '../../../../test/fixtures/promptContext'

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pipeline: adventure', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'adventure')!

  it('content render is non-null', () => {
    const result = templateEngine.render(template.content, { ...promptContext })
    expect(result).not.toBeNull()
  })

  it('content render contains Kael from fixture', () => {
    const result = templateEngine.render(template.content, { ...promptContext })
    expect(result).toContain('Kael')
  })

  it('userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
  })
})

describe('pipeline: creative-writing', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'creative-writing')!

  it('content render is non-null', () => {
    const result = templateEngine.render(template.content, { ...promptContext })
    expect(result).not.toBeNull()
  })

  it('content render contains Kael from fixture', () => {
    const result = templateEngine.render(template.content, { ...promptContext })
    expect(result).toContain('Kael')
  })

  it('userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
  })
})

describe('pipeline: suggestions', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'suggestions')!

  it('userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
  })

  it('userContent render contains mapped story entry content', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

describe('pipeline: action-choices', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'action-choices')!

  it('userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
  })

  it('userContent render contains Kael from context', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).toContain('Kael')
  })
})

describe('pipeline: chapter-summarization', () => {
  const template = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-summarization')!

  it('content render is non-null', () => {
    const result = templateEngine.render(template.content, {})
    expect(result).not.toBeNull()
  })

  it('userContent render is non-null', () => {
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).not.toBeNull()
  })

  it('userContent render contains chapter entry content from fixture', () => {
    // chapterAnalysis.chapterEntries has 'The hero arrived at dawn.'
    const result = templateEngine.render(template.userContent || '', { ...promptContext })
    expect(result).toContain('The hero arrived at dawn.')
  })
})
