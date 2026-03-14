import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

const template = PROMPT_TEMPLATES.find((t) => t.id === 'action-choices')!
const timelineFillTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'timeline-fill')!
const timelineFillAnswerTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'timeline-fill-answer')!

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

describe('timeline-fill template', () => {
  it('renders entry content from storyEntries array', () => {
    const result = templateEngine.render(timelineFillTemplate.userContent!, {
      storyEntries: [
        { type: 'user_action', content: 'I drew my sword.' },
        { type: 'narrative', content: 'The knight fell back.' },
      ],
      chapters: [{ number: 1, summary: 'The journey began.' }],
    })
    expect(result).toContain('I drew my sword.')
    expect(result).toContain('The knight fell back.')
    expect(result).toContain('The journey began.')
  })

  it('renders ACTION/NARRATIVE labels based on entry type', () => {
    const result = templateEngine.render(timelineFillTemplate.userContent!, {
      storyEntries: [
        { type: 'user_action', content: 'I climbed the wall.' },
        { type: 'narrative', content: 'Shadows gathered.' },
      ],
      chapters: [],
    })
    expect(result).toContain('[ACTION]')
    expect(result).toContain('[NARRATIVE]')
  })

  it('renders chapter number and summary in timeline section', () => {
    const result = templateEngine.render(timelineFillTemplate.userContent!, {
      storyEntries: [],
      chapters: [
        { number: 1, summary: 'The hero arrived in town.' },
        { number: 2, summary: 'A dragon was sighted.' },
      ],
    })
    expect(result).toContain('Chapter 1:')
    expect(result).toContain('The hero arrived in town.')
    expect(result).toContain('Chapter 2:')
    expect(result).toContain('A dragon was sighted.')
  })

  it('handles fewer than 10 entries without error', () => {
    const entries = [
      { type: 'narrative', content: 'Entry A' },
      { type: 'narrative', content: 'Entry B' },
      { type: 'narrative', content: 'Entry C' },
    ]
    const result = templateEngine.render(timelineFillTemplate.userContent!, {
      storyEntries: entries,
      chapters: [],
    })
    expect(result).toContain('Entry A')
    expect(result).toContain('Entry B')
    expect(result).toContain('Entry C')
  })

  it('renders only last 10 entries when more than 10 provided', () => {
    const entries = Array.from({ length: 15 }, (_, i) => ({
      type: 'narrative',
      content: `Entry ${i + 1}`,
    }))
    const result = templateEngine.render(timelineFillTemplate.userContent!, {
      storyEntries: entries,
      chapters: [],
    })
    expect(result).toContain('Entry 15')
    expect(result).not.toContain('Entry 1\n')
    expect(result).not.toContain('[NARRATIVE]: Entry 1\n')
  })
})

describe('timeline-fill-answer template', () => {
  it('renders chapter entries when entries present (entries mode)', () => {
    const result = templateEngine.render(timelineFillAnswerTemplate.userContent!, {
      answerChapters: [
        {
          number: 3,
          entries: [
            { type: 'user_action', content: 'I opened the gate.' },
            { type: 'narrative', content: 'Light flooded the room.' },
          ],
        },
      ],
      query: 'What happened at the gate?',
    })
    expect(result).toContain('Chapter 3')
    expect(result).toContain('I opened the gate.')
    expect(result).toContain('Light flooded the room.')
  })

  it('renders chapter summary when no entries (summary mode)', () => {
    const result = templateEngine.render(timelineFillAnswerTemplate.userContent!, {
      answerChapters: [
        {
          number: 5,
          summary: 'The party crossed the mountains.',
        },
      ],
      query: 'Where did the party go?',
    })
    expect(result).toContain('Chapter 5')
    expect(result).toContain('The party crossed the mountains.')
  })

  it('renders query variable', () => {
    const result = templateEngine.render(timelineFillAnswerTemplate.userContent!, {
      answerChapters: [{ number: 1, summary: 'Nothing special.' }],
      query: 'Did the hero find the amulet?',
    })
    expect(result).toContain('QUESTION:')
    expect(result).toContain('Did the hero find the amulet?')
  })

  it('handles mixed mode (some chapters with entries, some without)', () => {
    const result = templateEngine.render(timelineFillAnswerTemplate.userContent!, {
      answerChapters: [
        {
          number: 2,
          entries: [{ type: 'narrative', content: 'The battle raged on.' }],
        },
        {
          number: 4,
          summary: 'Peace was restored.',
        },
      ],
      query: 'What was the outcome?',
    })
    expect(result).toContain('The battle raged on.')
    expect(result).toContain('Peace was restored.')
  })

  it('renders chapter title when present', () => {
    const result = templateEngine.render(timelineFillAnswerTemplate.userContent!, {
      answerChapters: [
        {
          number: 7,
          title: 'The Final Stand',
          summary: 'The last battle.',
        },
      ],
      query: 'What was Chapter 7 about?',
    })
    expect(result).toContain(': The Final Stand')
  })
})
