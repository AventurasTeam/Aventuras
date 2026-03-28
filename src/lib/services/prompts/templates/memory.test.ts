import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

// ===== Template lookups =====

const chapterAnalysisTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-analysis')!
const chapterSummarizationTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-summarization')!
const loreManagementTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'lore-management')!
const agenticRetrievalTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'agentic-retrieval')!
const interactiveLorebookTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'interactive-lorebook')!

// ===== chapter-analysis =====

describe('chapter-analysis template', () => {
  it('renders entry type and content from messagesInRange array', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      firstValidId: 1,
      lastValidId: 3,
      messagesInRange: [
        { type: 'user_action', content: 'I open the gate.' },
        { type: 'narration', content: 'The gate creaks open.' },
      ],
    })
    expect(result).toContain('user_action')
    expect(result).toContain('I open the gate.')
    expect(result).toContain('narration')
    expect(result).toContain('The gate creaks open.')
  })

  it('renders correct Message ID using firstValidId offset', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      firstValidId: 5,
      lastValidId: 7,
      messagesInRange: [{ type: 'narration', content: 'Scene begins.' }],
    })
    expect(result).toContain('[Message 5]')
  })

  it('renders sequential Message IDs for multiple entries', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      firstValidId: 3,
      lastValidId: 5,
      messagesInRange: [
        { type: 'narration', content: 'First.' },
        { type: 'narration', content: 'Second.' },
        { type: 'narration', content: 'Third.' },
      ],
    })
    expect(result).toContain('[Message 3]')
    expect(result).toContain('[Message 4]')
    expect(result).toContain('[Message 5]')
  })

  it('renders without crash when messagesInRange is empty', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      firstValidId: 1,
      lastValidId: 1,
      messagesInRange: [],
    })
    expect(result).not.toBeNull()
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      firstValidId: 1,
      lastValidId: 2,
      messagesInRange: [{ type: 'narration', content: 'Text.' }],
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error (static)', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.content, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ===== chapter-summarization =====

describe('chapter-summarization template', () => {
  it('renders entry type and content from chapterEntries array', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [
        { type: 'narration', content: 'The hero arrived at dawn.' },
        { type: 'user_action', content: 'I search the room.' },
      ],
      previousChapters: [],
    })
    expect(result).toContain('narration')
    expect(result).toContain('The hero arrived at dawn.')
    expect(result).toContain('user_action')
    expect(result).toContain('I search the room.')
  })

  it('renders previousChapters with number and summary', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [],
      previousChapters: [
        { number: 1, summary: 'The village burned.' },
        { number: 2, summary: 'The hero fled.' },
      ],
    })
    expect(result).toContain('Chapter 1:')
    expect(result).toContain('The village burned.')
    expect(result).toContain('Chapter 2:')
    expect(result).toContain('The hero fled.')
  })

  it('renders "Previous chapters:" header when previousChapters has entries', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [],
      previousChapters: [{ number: 1, summary: 'Summary.' }],
    })
    expect(result).toContain('Previous chapters:')
  })

  it('does not render "Previous chapters:" header when previousChapters is empty', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [],
      previousChapters: [],
    })
    expect(result).not.toContain('Previous chapters:')
  })

  it('renders without crash when both arrays are empty', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [],
      previousChapters: [],
    })
    expect(result).not.toBeNull()
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      chapterEntries: [{ type: 'narration', content: 'Text.' }],
      previousChapters: [{ number: 1, summary: 'Summary.' }],
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error (static)', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.content, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ===== lore-management =====

describe('lore-management template', () => {
  it('renders lore entry with 0-based index, name, type, description', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [
        { type: 'character', name: 'Aldric', description: 'A brave knight.' },
        { type: 'location', name: 'Iron Keep', description: 'A fortress in the north.' },
      ],
      loreChapters: [],
    })
    expect(result).toContain('[0]')
    expect(result).toContain('[character]')
    expect(result).toContain('Aldric')
    expect(result).toContain('A brave knight.')
    expect(result).toContain('[1]')
    expect(result).toContain('[location]')
    expect(result).toContain('Iron Keep')
  })

  it('renders loreChapters with chapter number and summary', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [],
      loreChapters: [
        { number: 1, summary: 'The siege began.' },
        { number: 2, title: 'The Retreat', summary: 'Forces fell back.' },
      ],
    })
    expect(result).toContain('Chapter 1')
    expect(result).toContain('The siege began.')
    expect(result).toContain('Chapter 2')
    expect(result).toContain('The Retreat')
    expect(result).toContain('Forces fell back.')
  })

  it('renders fallback text when loreChapters is empty', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [],
      loreChapters: [],
    })
    expect(result).toContain('No chapters available.')
  })

  it('does not contain recentStorySection in rendered output', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [],
      loreChapters: [],
    })
    expect(result).not.toContain('recentStorySection')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [{ type: 'concept', name: 'Magic', description: 'Mysterious power.' }],
      loreChapters: [{ number: 1, summary: 'Magic was discovered.' }],
    })
    expect(result).not.toContain('[object Object]')
  })

  it('renders without crash when loreEntries is empty', () => {
    const result = templateEngine.render(loreManagementTemplate.userContent!, {
      loreEntries: [],
      loreChapters: [],
    })
    expect(result).not.toBeNull()
  })

  it('content renders without error (static)', () => {
    const result = templateEngine.render(loreManagementTemplate.content, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ===== agentic-retrieval =====

describe('agentic-retrieval template', () => {
  it('renders agenticChapters with number and summary', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'What did we find?',
      recentEntries: [{ type: 'narration', content: 'We stand at the cave entrance.' }],
      chaptersCount: 2,
      agenticChapters: [
        { number: 1, summary: 'The cave was mapped.' },
        { number: 2, title: 'The Find', summary: 'An artifact was found.' },
      ],
      entriesCount: 0,
      agenticEntries: [],
    })
    expect(result).toContain('Chapter 1')
    expect(result).toContain('The cave was mapped.')
    expect(result).toContain('Chapter 2')
    expect(result).toContain('The Find')
    expect(result).toContain('An artifact was found.')
  })

  it('renders agenticEntries with 0-based index, type, name', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'Who is here?',
      recentEntries: [{ type: 'narration', content: 'A figure approaches.' }],
      chaptersCount: 0,
      agenticChapters: [],
      entriesCount: 2,
      agenticEntries: [
        { type: 'character', name: 'Thane' },
        { type: 'location', name: 'The Ruins' },
      ],
    })
    expect(result).toContain('0.')
    expect(result).toContain('[character]')
    expect(result).toContain('Thane')
    expect(result).toContain('1.')
    expect(result).toContain('[location]')
    expect(result).toContain('The Ruins')
  })

  it('renders recentEntries array entries correctly', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'What happened next?',
      recentEntries: [
        { type: 'narration', content: 'The door creaked open.' },
        { type: 'user_action', content: 'I step inside carefully.' },
        { type: 'narration', content: 'Dust swirled in the dim light.' },
      ],
      chaptersCount: 0,
      agenticChapters: [],
      entriesCount: 0,
      agenticEntries: [],
    })
    expect(result).toContain('The door creaked open.')
    expect(result).toContain('I step inside carefully.')
    expect(result).toContain('Dust swirled in the dim light.')
  })

  it('renders "No chapters available." fallback when agenticChapters is empty', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'Input.',
      recentEntries: [],
      chaptersCount: 0,
      agenticChapters: [],
      entriesCount: 0,
      agenticEntries: [],
    })
    expect(result).toContain('No chapters available.')
  })

  it('renders "No entries available." fallback when agenticEntries is empty', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'Input.',
      recentEntries: [],
      chaptersCount: 0,
      agenticChapters: [],
      entriesCount: 0,
      agenticEntries: [],
    })
    expect(result).toContain('No entries available.')
  })

  it('does not render recentContext variable name in output', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'Input.',
      recentEntries: [],
      chaptersCount: 0,
      agenticChapters: [],
      entriesCount: 0,
      agenticEntries: [],
    })
    expect(result).not.toContain('recentContext')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      userInput: 'Input.',
      recentEntries: [{ type: 'narration', content: 'Scene text.' }],
      chaptersCount: 1,
      agenticChapters: [{ number: 1, summary: 'Summary.' }],
      entriesCount: 1,
      agenticEntries: [{ type: 'character', name: 'Hero' }],
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error (static)', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.content, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ===== interactive-lorebook =====

describe('interactive-lorebook template', () => {
  it('renders count variables in content', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 5,
      lorebookCount: 3,
      totalEntryCount: 42,
      scenarioCount: 2,
      focusedEntity: null,
    })
    expect(result).toContain('5')
    expect(result).toContain('3')
    expect(result).toContain('42')
    expect(result).toContain('2')
  })

  it('renders focusedEntity Active Context section when focusedEntity is present', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 1,
      lorebookCount: 0,
      totalEntryCount: 0,
      scenarioCount: 0,
      focusedEntity: {
        entityType: 'character',
        entityName: 'Lady Mirelle',
        entityId: 'char-001',
      },
    })
    expect(result).toContain('## Active Context')
    expect(result).toContain('character')
    expect(result).toContain('Lady Mirelle')
    expect(result).toContain('char-001')
  })

  it('does not render Active Context section when focusedEntity is null', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 0,
      lorebookCount: 0,
      totalEntryCount: 0,
      scenarioCount: 0,
      focusedEntity: null,
    })
    expect(result).not.toContain('## Active Context')
  })

  it('renders exact Active Context wording preserved from original service', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 1,
      lorebookCount: 1,
      totalEntryCount: 5,
      scenarioCount: 1,
      focusedEntity: {
        entityType: 'lorebook',
        entityName: 'World Atlas',
        entityId: 'lb-999',
      },
    })
    expect(result).toContain('The user opened this assistant from the lorebook editor for')
    expect(result).toContain('"World Atlas"')
    expect(result).toContain('lb-999')
    expect(result).toContain(
      'When the user refers to "this character", "this lorebook", "this scenario", or uses pronouns referencing an entity without naming it, assume they mean this one.',
    )
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 2,
      lorebookCount: 1,
      totalEntryCount: 10,
      scenarioCount: 3,
      focusedEntity: {
        entityType: 'scenario',
        entityName: 'The Dark Forest',
        entityId: 'sc-007',
      },
    })
    expect(result).not.toContain('[object Object]')
  })

  it('renders without crash when all counts are zero', () => {
    const result = templateEngine.render(interactiveLorebookTemplate.content, {
      characterCount: 0,
      lorebookCount: 0,
      totalEntryCount: 0,
      scenarioCount: 0,
      focusedEntity: null,
    })
    expect(result).not.toBeNull()
  })
})
