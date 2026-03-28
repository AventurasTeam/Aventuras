import { describe, it, expect, beforeEach, vi } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext, promptContextMinimal } from '../../../../test/fixtures/promptContext'

const adventureTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'adventure')!
const creativeWritingTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'creative-writing')!

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.resetModules()
})

// ---------------------------------------------------------------------------
// Adventure template
// ---------------------------------------------------------------------------

describe('adventure template', () => {
  describe('variable injection', () => {
    it('renders protagonistName in content', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Kael')
    })

    it('renders genre in Story Context when genre is set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Fantasy')
    })
  })

  describe('conditional suppression', () => {
    it('Story Context absent when genre, tone, settingDescription, themes all empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
        themes: '',
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('# Story Context')
    })

    it('Story Context present when genre is set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
        genre: 'Fantasy',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('# Story Context')
    })

    it('lorebook section absent when lorebookEntries is empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      // The dynamic lorebook section starts with this canonical disclaimer; absent when empty
      expect(result).not.toContain('(CANONICAL')
    })

    it('lorebook section present when lorebookEntries has 1 item', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
        retrievalResult: {
          ...promptContextMinimal.retrievalResult,
          lorebookEntries: [
            { name: 'Elder Dragon', type: 'character', description: 'An ancient beast.' },
          ],
        },
      })
      expect(result).not.toBeNull()
      expect(result).toContain('(CANONICAL')
    })

    it('worldStateCharacters absent when empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('[KNOWN CHARACTERS]')
    })

    it('worldStateCharacters present when has items', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
        relevantWorldState: {
          ...promptContextMinimal.relevantWorldState,
          characters: [
            {
              name: 'Aria',
              relationship: 'companion',
              description: '',
              traits: [],
              appearance: [],
              tier: 1,
              status: 'active',
            },
          ],
        },
      })
      expect(result).not.toBeNull()
      expect(result).toContain('[KNOWN CHARACTERS]')
    })

    it('story_history absent when chapters and timelineFill both empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('<story_history>')
    })

    it('story_history present when chapters has items', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<story_history>')
    })

    it('style_guidance absent when styleReview not provided', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('<style_guidance>')
    })

    it('style_guidance present when styleReview.phrases has items', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<style_guidance>')
    })

    it('Recent Story section present in userContent when storyEntriesVisibleRaw.size > 1', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('## Recent Story:')
    })

    it('Recent Story section absent in userContent when storyEntriesVisibleRaw.size <= 1', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContextMinimal,
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I draw my sword.' }],
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('## Recent Story:')
    })
  })

  describe('array iteration', () => {
    it('worldStateCharacters with 2 entries renders both names', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Aria')
      expect(result).toContain('Marcus')
    })

    it('lorebookEntries with multiple items renders lorebook names', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The Shadow Guild')
      expect(result).toContain('Elder Dragon')
    })

    it('storyEntries in userContent renders entry content strings', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The torches flickered')
      expect(result).toContain('I draw my sword')
    })
  })

  describe('no crash on missing optional vars', () => {
    it('renders content with only required vars present', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
      })
      expect(result).not.toBeNull()
    })

    it('renders userContent with minimal vars present', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
        storyEntriesVisibleRaw: [],
      })
      expect(result).not.toBeNull()
    })
  })

  describe('POV/tense branches', () => {
    it('second-person-present: userContent contains "second person"', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContextMinimal,
        pov: 'second',
        tense: 'present',
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('second person')
    })

    it('third-person-past: userContent contains "third person"', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContextMinimal,
        pov: 'third',
        tense: 'past',
        protagonistName: 'Kael',
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('third person')
    })

    it('second-person-present and third-person-past renders produce distinct output', () => {
      const secondPerson = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContextMinimal,
        pov: 'second',
        tense: 'present',
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I open the door.' }],
      })
      const thirdPerson = templateEngine.render(adventureTemplate.userContent!, {
        ...promptContextMinimal,
        pov: 'third',
        tense: 'past',
        protagonistName: 'Kael',
        storyEntriesVisibleRaw: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(secondPerson).not.toEqual(thirdPerson)
    })
  })

  describe('agentic retrieval fields', () => {
    it('agenticReasoning section absent when not provided', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('[AGENT CONTEXT]')
    })

    it('agenticReasoning section present when set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Selected entries relevant to the temple exploration.')
    })

    it('agenticChapterSummary renders when set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('In chapter 1, the party entered the Thornwood')
      expect(result).toContain('## Past Story Context')
    })

    it('agenticSelectedEntries renders heading-per-entry format', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('## Elder Dragon (character)')
      expect(result).toContain('An ancient beast guarding the Sunken Temple.')
    })

    it('agenticRetrievalContext absent from template (old variable no longer rendered)', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...promptContextMinimal,
        agenticRetrievalContext: 'STALE_STRING',
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('STALE_STRING')
    })
  })
})

// ---------------------------------------------------------------------------
// Creative-writing template
// ---------------------------------------------------------------------------

describe('creative-writing template', () => {
  describe('variable injection', () => {
    it('renders protagonistName in content', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Kael')
    })
  })

  describe('conditional suppression', () => {
    it('Story Context absent when genre, tone, settingDescription, themes all empty', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
        themes: '',
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('# Story Context')
    })

    it('Story Context present when genre is set', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
        genre: 'Literary Fiction',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('# Story Context')
    })

    it('lorebook section absent when lorebookEntries is empty', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      // The dynamic lorebook section starts with this canonical disclaimer; absent when empty
      expect(result).not.toContain('(CANONICAL')
    })

    it('lorebook section present when lorebookEntries has 1 item', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
        retrievalResult: {
          ...promptContextMinimal.retrievalResult,
          lorebookEntries: [
            { name: 'Elder Dragon', type: 'character', description: 'An ancient beast.' },
          ],
        },
      })
      expect(result).not.toBeNull()
      expect(result).toContain('(CANONICAL')
    })
  })

  describe('array iteration', () => {
    it('worldStateCharacters with 2 entries renders both names', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Aria')
      expect(result).toContain('Marcus')
    })
  })

  describe('no crash on missing optional vars', () => {
    it('renders content with only required vars present', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
      })
      expect(result).not.toBeNull()
    })
  })

  describe('agentic retrieval fields', () => {
    it('agenticReasoning section absent when not provided', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('[AGENT CONTEXT]')
    })

    it('agenticReasoning section present when set', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Selected entries relevant to the temple exploration.')
    })

    it('agenticChapterSummary renders when set', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('In chapter 1, the party entered the Thornwood')
      expect(result).toContain('## Past Story Context')
    })

    it('agenticSelectedEntries renders heading-per-entry format', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContext,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('## Elder Dragon (character)')
      expect(result).toContain('An ancient beast guarding the Sunken Temple.')
    })

    it('agenticRetrievalContext absent from template (old variable no longer rendered)', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...promptContextMinimal,
        agenticRetrievalContext: 'STALE_STRING',
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('STALE_STRING')
    })
  })
})
