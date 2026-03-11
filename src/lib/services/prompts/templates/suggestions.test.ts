import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

const template = PROMPT_TEMPLATES.find((t) => t.id === 'suggestions')!

const suggestionsBase = {
  storyEntries: [],
  lorebookEntries: [],
  activeThreads: '',
  genre: '',
}

describe('suggestions template', () => {
  describe('TMPL-01: variable injection', () => {
    it('renders genre in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        ...suggestionsBase,
        genre: 'Fantasy',
      })
      expect(result).toContain('Fantasy')
    })

    it('renders activeThreads in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        ...suggestionsBase,
        activeThreads: 'Quest for the artifact',
      })
      expect(result).toContain('Quest for the artifact')
    })
  })

  describe('TMPL-02: conditional suppression', () => {
    it('lorebook section absent when lorebookEntries empty', () => {
      const result = templateEngine.render(template.userContent!, { ...suggestionsBase })
      expect(result).not.toContain('## Lorebook/World Elements')
    })

    it('lorebook section present when lorebookEntries has items', () => {
      const result = templateEngine.render(template.userContent!, {
        ...suggestionsBase,
        lorebookEntries: [
          { name: 'Dragon', type: 'creature', description: 'Fire breather', tier: 1 },
        ],
      })
      expect(result).toContain('## Lorebook/World Elements')
    })
  })

  describe('TMPL-03: array iteration', () => {
    it('storyEntries loop renders 2 entries', () => {
      const result = templateEngine.render(template.userContent!, {
        ...suggestionsBase,
        storyEntries: [
          { type: 'narrative', content: 'The sun rose.' },
          { type: 'user_action', content: 'I ran.' },
        ],
      })
      expect(result).toContain('The sun rose.')
      expect(result).toContain('I ran.')
    })

    it('lorebookEntries loop renders 2 entries when present', () => {
      const result = templateEngine.render(template.userContent!, {
        ...suggestionsBase,
        lorebookEntries: [
          { name: 'The Forest', type: 'location', description: 'Dense and dark.', tier: 1 },
          { name: 'Elder Mage', type: 'character', description: 'Ancient and wise.', tier: 2 },
        ],
      })
      expect(result).toContain('The Forest')
      expect(result).toContain('Elder Mage')
    })
  })

  describe('TMPL-04: no crash on missing optional vars', () => {
    it('userContent renders without crash when all optional vars absent', () => {
      const result = templateEngine.render(template.userContent!, {})
      expect(result).not.toBeNull()
    })

    it('content renders without crash', () => {
      const result = templateEngine.render(template.content, {})
      expect(result).not.toBeNull()
    })
  })
})
