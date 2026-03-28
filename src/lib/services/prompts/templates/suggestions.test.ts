import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext, promptContextMinimal } from '../../../../test/fixtures/promptContext'

const template = PROMPT_TEMPLATES.find((t) => t.id === 'suggestions')!

describe('suggestions template', () => {
  describe('variable injection', () => {
    it('renders genre in userContent', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContext })
      expect(result).toContain('Fantasy')
    })

    it('renders activeThreads from storyBeats', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContext })
      expect(result).toContain('Find the Lost Temple')
    })
  })

  describe('conditional suppression', () => {
    it('lorebook section absent when retrievalResult.lorebookEntries empty', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContextMinimal })
      expect(result).not.toContain('## Lorebook/World Elements')
    })

    it('lorebook section present when retrievalResult.lorebookEntries has items', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContext })
      // promptContext has retrievalResult.lorebookEntries with entries
      expect(result).toContain('## Lorebook/World Elements')
    })
  })

  describe('array iteration', () => {
    it('storyEntries loop renders entries from storyEntriesVisible', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContext })
      // Template slices last 5 from storyEntriesVisible (3 entries → last 2 via slice:-5,5)
      expect(result).toContain('I draw my sword and step cautiously forward.')
      expect(result).toContain(
        'The gate creaked open, revealing a vast underground chamber lit by phosphorescent moss.',
      )
    })

    it('lorebookEntries loop renders entries when present', () => {
      const result = templateEngine.render(template.userContent!, { ...promptContext })
      // retrievalResult.lorebookEntries includes these from fixture
      expect(result).toContain('The Shadow Guild')
      expect(result).toContain('Elder Dragon')
    })
  })

  describe('no crash on missing optional vars', () => {
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
