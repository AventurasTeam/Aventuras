import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

const template = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-summarization')!

describe('chapter-summarization template', () => {
  describe('variable injection', () => {
    it('renders previousContext in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        previousContext: 'Earlier events: the village was attacked.',
        chapterContent: '',
      })
      expect(result).toContain('Earlier events: the village was attacked.')
    })

    it('renders chapterContent in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        previousContext: '',
        chapterContent: 'The hero found a sword.',
      })
      expect(result).toContain('The hero found a sword.')
    })

    it('content renders without error (static)', () => {
      const result = templateEngine.render(template.content, {})
      expect(result).not.toBeNull()
    })
  })

  describe('conditional suppression', () => {
    it('content renders with empty context (no conditionals to suppress)', () => {
      const result = templateEngine.render(template.content, {})
      expect(result).not.toBeNull()
      expect(result!.length).toBeGreaterThan(0)
    })
  })

  describe('array iteration', () => {
    it('userContent renders with both vars set', () => {
      const result = templateEngine.render(template.userContent!, {
        previousContext: 'Context.',
        chapterContent: 'Chapter.',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Context.')
      expect(result).toContain('Chapter.')
    })
  })

  describe('no crash on missing optional vars', () => {
    it('userContent renders without crash when both vars absent', () => {
      const result = templateEngine.render(template.userContent!, {})
      expect(result).not.toBeNull()
    })

    it('content renders without crash with empty context', () => {
      const result = templateEngine.render(template.content, {})
      expect(result).not.toBeNull()
    })
  })
})
