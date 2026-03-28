import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import {
  promptContext,
  promptContextMinimal,
} from '../../../../test/fixtures/promptContext'

// ===== Template lookups =====

const chapterAnalysisTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'chapter-analysis')!
const chapterSummarizationTemplate = PROMPT_TEMPLATES.find(
  (t) => t.id === 'chapter-summarization',
)!
const loreManagementTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'lore-management')!
const agenticRetrievalTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'agentic-retrieval')!
const interactiveLorebookTemplate = PROMPT_TEMPLATES.find(
  (t) => t.id === 'interactive-lorebook',
)!

// ===== chapter-analysis =====

describe('chapter-analysis template', () => {
  it('renders entry type and content from chapterAnalysis.analysisEntries', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('user_action')
    expect(result).toContain('I open the gate.')
    expect(result).toContain('narration')
    expect(result).toContain('The gate creaks open, revealing a passage.')
  })

  it('renders correct Message ID using lastChapterEndIndex', () => {
    // fixture lastChapterEndIndex is 0, so firstValidId = 1
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('[Message 1]')
  })

  it('renders sequential Message IDs based on lastChapterEndIndex', () => {
    // lastChapterEndIndex=0 → firstValidId=1, 3 entries → Messages 1, 2, 3
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('[Message 1]')
    expect(result).toContain('[Message 2]')
    expect(result).toContain('[Message 3]')
  })

  it('renders without crash when empty', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).not.toBeNull()
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error', () => {
    const result = templateEngine.render(chapterAnalysisTemplate.content, {})
    expect(result).not.toBeNull()
    expect(result!.length).toBeGreaterThan(0)
  })
})

// ===== chapter-summarization =====

describe('chapter-summarization template', () => {
  it('renders entry type and content from chapterEntries', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('narration')
    expect(result).toContain('The hero arrived at dawn.')
    expect(result).toContain('user_action')
    expect(result).toContain('I search the room carefully.')
  })

  it('renders previousChapters', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Chapter 1:')
    expect(result).toContain('Chapter 2:')
  })

  it('renders Previous chapters header', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Previous chapters:')
  })

  it('does not render header when empty', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).not.toContain('Previous chapters:')
  })

  it('renders without crash when both empty', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).not.toBeNull()
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(chapterSummarizationTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error', () => {
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
  it('renders agenticChapters', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Chapter 1')
    expect(result).toContain('Into the Woods')
  })

  it('renders agenticEntries', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('0.')
    expect(result).toContain('[faction]')
    expect(result).toContain('The Shadow Guild')
  })

  it('renders recentEntries', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContext,
    })
    // storyEntries from fixture contain these entries
    expect(result).toContain(
      'The torches flickered against the stone walls of the ancient chamber.',
    )
  })

  it('renders fallback when empty', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).toContain('No chapters available.')
  })

  it('does not render recentContext', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).not.toContain('recentContext')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(agenticRetrievalTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })

  it('content renders without error', () => {
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
