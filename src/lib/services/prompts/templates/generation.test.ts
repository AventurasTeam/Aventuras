import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

const template = PROMPT_TEMPLATES.find((t) => t.id === 'action-choices')!

const actionChoicesBase = {
  protagonistName: 'Kael',
  protagonistDescription: '',
  narrativeResponse: '',
  storyEntries: [],
  currentLocation: '',
  npcsPresent: '',
  inventory: '',
  activeQuests: '',
  lorebookEntries: [],
  povInstruction: '',
  lengthInstruction: '',
}

describe('action-choices template', () => {
  describe('variable injection', () => {
    it('renders protagonistName in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        protagonistName: 'Kael',
      })
      expect(result).toContain('Kael')
    })

    it('renders narrativeResponse in userContent', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        narrativeResponse: 'The gate opened slowly.',
      })
      expect(result).toContain('The gate opened slowly.')
    })
  })

  describe('conditional suppression', () => {
    it('World Context section absent when lorebookEntries empty', () => {
      const result = templateEngine.render(template.userContent!, { ...actionChoicesBase })
      expect(result).not.toContain('## World Context')
    })

    it('World Context section present when lorebookEntries has items', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        lorebookEntries: [
          { name: 'The Keep', type: 'location', description: 'A dark fortress.', tier: 1 },
        ],
      })
      expect(result).toContain('## World Context')
    })

    it('Style Notes section absent when styleReview has no phrases', () => {
      const result = templateEngine.render(template.userContent!, { ...actionChoicesBase })
      expect(result).not.toContain('## Style Notes')
    })

    it('Style Notes section present when styleReview has phrases', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        styleReview: {
          phrases: [{ phrase: 'very very', count: 4 }],
          overallAssessment: 'Varies well.',
          reviewedEntryCount: 3,
        },
      })
      expect(result).toContain('## Style Notes')
    })
  })

  describe('array iteration', () => {
    it('storyEntries loop renders 2 entries', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        storyEntries: [
          { type: 'narrative', content: 'The bridge collapsed.' },
          { type: 'user_action', content: 'I grabbed the rope.' },
        ],
      })
      expect(result).toContain('The bridge collapsed.')
      expect(result).toContain('I grabbed the rope.')
    })

    it('lorebookEntries loop renders 2 items when present', () => {
      const result = templateEngine.render(template.userContent!, {
        ...actionChoicesBase,
        lorebookEntries: [
          { name: 'Ancient Sword', type: 'item', description: 'Glows blue.', tier: 1 },
          { name: 'Shadow Guild', type: 'faction', description: 'Operates in darkness.', tier: 2 },
        ],
      })
      expect(result).toContain('Ancient Sword')
      expect(result).toContain('Shadow Guild')
    })
  })

  describe('no crash on missing optional vars', () => {
    it('userContent renders without crash when optional vars absent', () => {
      const result = templateEngine.render(template.userContent!, { protagonistName: 'Hero' })
      expect(result).not.toBeNull()
    })

    it('content renders without crash', () => {
      const result = templateEngine.render(template.content, {})
      expect(result).not.toBeNull()
    })
  })
})
