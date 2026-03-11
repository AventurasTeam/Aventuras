import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { computeShims } from '$lib/services/context/compatShims'
import { shimContext } from '../../../../test/contextFixtures'

const adventureTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'adventure')!
const creativeWritingTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'creative-writing')!

const adventureBase = {
  protagonistName: 'Kael',
  pov: 'second',
  tense: 'present',
  genre: '',
  tone: '',
  settingDescription: '',
  themes: '',
  storyEntries: [],
  lorebookEntries: [],
  worldStateCharacters: [],
  worldStateInventory: [],
  worldStateBeats: [],
  worldStateLocations: [],
  worldStateRelevantItems: [],
  worldStateRelatedBeats: [],
  chapters: [],
  timelineFill: [],
}

// ---------------------------------------------------------------------------
// Adventure template
// ---------------------------------------------------------------------------

describe('adventure template', () => {
  // TMPL-01: variable injection
  describe('TMPL-01: variable injection', () => {
    it('renders protagonistName in content', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        protagonistName: 'Kael',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Kael')
    })

    it('renders genre in Story Context when genre is set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        genre: 'Fantasy',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Fantasy')
    })
  })

  // TMPL-02: conditional suppression
  describe('TMPL-02: conditional suppression', () => {
    it('Story Context absent when genre, tone, settingDescription, themes all empty', () => {
      const result = templateEngine.render(adventureTemplate.content, { ...adventureBase })
      expect(result).not.toBeNull()
      expect(result).not.toContain('# Story Context')
    })

    it('Story Context present when genre is set', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        genre: 'Fantasy',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('# Story Context')
    })

    it('lorebook section absent when lorebookEntries is empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        lorebookEntries: [],
      })
      expect(result).not.toBeNull()
      // The dynamic lorebook section starts with this canonical disclaimer; absent when empty
      expect(result).not.toContain('(CANONICAL')
    })

    it('lorebook section present when lorebookEntries has 1 item', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        lorebookEntries: [
          { name: 'Elder Dragon', type: 'character', description: 'An ancient beast.' },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('(CANONICAL')
    })

    it('worldStateCharacters absent when empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        worldStateCharacters: [],
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('[KNOWN CHARACTERS]')
    })

    it('worldStateCharacters present when has items', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        worldStateCharacters: [
          { name: 'Aria', relationship: 'companion', description: '', traits: [], appearance: [] },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('[KNOWN CHARACTERS]')
    })

    it('story_history absent when chapters and timelineFill both empty', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        chapters: [],
        timelineFill: [],
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('<story_history>')
    })

    it('story_history present when chapters has 1 item', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        chapters: [
          {
            number: 1,
            title: 'The Beginning',
            summary: 'Things began.',
            startTime: null,
            endTime: null,
            characters: [],
            locations: [],
            emotionalTone: '',
          },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<story_history>')
    })

    it('style_guidance absent when styleReview not provided', () => {
      const result = templateEngine.render(adventureTemplate.content, { ...adventureBase })
      expect(result).not.toBeNull()
      expect(result).not.toContain('<style_guidance>')
    })

    it('style_guidance present when styleReview.phrases has items', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        styleReview: {
          phrases: [
            {
              phrase: 'dark and stormy',
              count: 3,
              frequency: 3,
              severity: 'low',
              alternatives: [],
            },
          ],
          overallAssessment: 'Good variety.',
          reviewedEntryCount: 5,
        },
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<style_guidance>')
    })

    it('Recent Story section present in userContent when storyEntries.size > 1', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        storyEntries: [
          { type: 'narration', content: 'The torches flickered.' },
          { type: 'user_action', content: 'I draw my sword.' },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('## Recent Story:')
    })

    it('Recent Story section absent in userContent when storyEntries.size <= 1', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        storyEntries: [{ type: 'user_action', content: 'I draw my sword.' }],
      })
      expect(result).not.toBeNull()
      expect(result).not.toContain('## Recent Story:')
    })
  })

  // TMPL-03: array iteration
  describe('TMPL-03: array iteration', () => {
    it('worldStateCharacters with 2 entries renders both names', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        worldStateCharacters: [
          { name: 'Alice', relationship: '', description: '', traits: [], appearance: [] },
          { name: 'Bob', relationship: '', description: '', traits: [], appearance: [] },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
    })

    it('lorebookEntries with 2 items renders both lorebook names', () => {
      const result = templateEngine.render(adventureTemplate.content, {
        ...adventureBase,
        lorebookEntries: [
          { name: 'The Shadow Guild', type: 'faction', description: 'A secretive org.' },
          { name: 'Lord Malachar', type: 'character', description: 'A sinister nobleman.' },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The Shadow Guild')
      expect(result).toContain('Lord Malachar')
    })

    it('storyEntries with 2 items in userContent renders both content strings', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        storyEntries: [
          { type: 'narration', content: 'The torches flickered.' },
          { type: 'user_action', content: 'I draw my sword.' },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The torches flickered.')
      expect(result).toContain('I draw my sword.')
    })
  })

  // TMPL-04: no crash on missing optional vars
  describe('TMPL-04: no crash on missing optional vars', () => {
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
        storyEntries: [],
      })
      expect(result).not.toBeNull()
    })
  })

  // TMPL-05: POV/tense branches (adventure only)
  describe('TMPL-05: POV/tense branches', () => {
    it('second-person-present: userContent contains "second person"', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        pov: 'second',
        tense: 'present',
        storyEntries: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('second person')
    })

    it('third-person-past: userContent contains "third person"', () => {
      const result = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        pov: 'third',
        tense: 'past',
        protagonistName: 'Kael',
        storyEntries: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('third person')
    })

    it('second-person-present and third-person-past renders produce distinct output', () => {
      const secondPerson = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        pov: 'second',
        tense: 'present',
        storyEntries: [{ type: 'user_action', content: 'I open the door.' }],
      })
      const thirdPerson = templateEngine.render(adventureTemplate.userContent!, {
        ...adventureBase,
        pov: 'third',
        tense: 'past',
        protagonistName: 'Kael',
        storyEntries: [{ type: 'user_action', content: 'I open the door.' }],
      })
      expect(secondPerson).not.toEqual(thirdPerson)
    })
  })

  // TMPL-06: compat shim rendering
  describe('TMPL-06: compat shim rendering', () => {
    it('tieredContextBlock shim injects into template string referencing it', () => {
      const templateSource = 'World: {{ tieredContextBlock }}'
      const shims = computeShims(
        shimContext as Record<string, unknown>,
        templateSource,
        'adventure',
      )
      const result = templateEngine.render(templateSource, {
        ...(shimContext as Record<string, unknown>),
        ...shims,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The Crossroads Inn')
    })

    it('chapterSummaries shim injects into template string referencing it', () => {
      const templateSource = 'Chapters: {{ chapterSummaries }}'
      const shims = computeShims(
        shimContext as Record<string, unknown>,
        templateSource,
        'adventure',
      )
      const result = templateEngine.render(templateSource, {
        ...(shimContext as Record<string, unknown>),
        ...shims,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The Beginning')
    })

    it('styleGuidance shim injects into template string referencing it', () => {
      const templateSource = 'Style: {{ styleGuidance }}'
      const shims = computeShims(
        shimContext as Record<string, unknown>,
        templateSource,
        'adventure',
      )
      const result = templateEngine.render(templateSource, {
        ...(shimContext as Record<string, unknown>),
        ...shims,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('<style_guidance>')
    })

    it('lorebookContext shim injects into template string referencing it', () => {
      const templateSource = 'Lore: {{ lorebookContext }}'
      const shims = computeShims(
        shimContext as Record<string, unknown>,
        templateSource,
        'adventure',
      )
      const result = templateEngine.render(templateSource, {
        ...(shimContext as Record<string, unknown>),
        ...shims,
      })
      expect(result).not.toBeNull()
      expect(result).toContain('The Shadow Guild')
    })
  })
})

// ---------------------------------------------------------------------------
// Creative-writing template
// ---------------------------------------------------------------------------

describe('creative-writing template', () => {
  // TMPL-01: variable injection
  describe('TMPL-01: variable injection', () => {
    it('renders protagonistName in content', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...adventureBase,
        protagonistName: 'Kael',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Kael')
    })
  })

  // TMPL-02: conditional suppression
  describe('TMPL-02: conditional suppression', () => {
    it('Story Context absent when genre, tone, settingDescription, themes all empty', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, { ...adventureBase })
      expect(result).not.toBeNull()
      expect(result).not.toContain('# Story Context')
    })

    it('Story Context present when genre is set', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...adventureBase,
        genre: 'Literary Fiction',
      })
      expect(result).not.toBeNull()
      expect(result).toContain('# Story Context')
    })

    it('lorebook section absent when lorebookEntries is empty', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...adventureBase,
        lorebookEntries: [],
      })
      expect(result).not.toBeNull()
      // The dynamic lorebook section starts with this canonical disclaimer; absent when empty
      expect(result).not.toContain('(CANONICAL')
    })

    it('lorebook section present when lorebookEntries has 1 item', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...adventureBase,
        lorebookEntries: [
          { name: 'Elder Dragon', type: 'character', description: 'An ancient beast.' },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('(CANONICAL')
    })
  })

  // TMPL-03: array iteration
  describe('TMPL-03: array iteration', () => {
    it('worldStateCharacters with 2 entries renders both names', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        ...adventureBase,
        worldStateCharacters: [
          { name: 'Alice', relationship: '', description: '', traits: [], appearance: [] },
          { name: 'Bob', relationship: '', description: '', traits: [], appearance: [] },
        ],
      })
      expect(result).not.toBeNull()
      expect(result).toContain('Alice')
      expect(result).toContain('Bob')
    })
  })

  // TMPL-04: no crash on missing optional vars
  describe('TMPL-04: no crash on missing optional vars', () => {
    it('renders content with only required vars present', () => {
      const result = templateEngine.render(creativeWritingTemplate.content, {
        protagonistName: 'Hero',
        pov: 'second',
        tense: 'present',
      })
      expect(result).not.toBeNull()
    })
  })
})
