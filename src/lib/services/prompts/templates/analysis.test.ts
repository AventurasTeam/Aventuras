import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'

// ===== Template lookups =====

const classifierTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'classifier')!
const styleReviewerTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'style-reviewer')!
const tier3Template = PROMPT_TEMPLATES.find((t) => t.id === 'tier3-entry-selection')!
const lorebookClassifierTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'lorebook-classifier')!

// ===== Base contexts =====

const classifierBase = {
  characters: [],
  storyBeats: [],
  chatHistory: [],
  locations: [],
  items: [],
  genre: '',
  mode: 'adventure',
  entityCounts: '0 characters, 0 locations, 0 items',
  currentTimeInfo: '',
  inputLabel: 'Player Action',
  userAction: 'Look around the room',
  narrativeResponse: 'You see a dusty chamber.',
  storyBeatTypes: 'milestone, quest, revelation, event, plot_point',
  itemLocationOptions: 'inventory, worn, ground',
  defaultItemLocation: 'inventory',
  sceneLocationDesc: '',
}

const styleReviewerBase = {
  passages: [],
  passageCount: '0',
  mode: 'adventure',
  pov: 'second person',
  tense: 'present',
}

const tier3Base = {
  availableEntries: [],
  recentEntries: [],
  userInput: 'Search the area',
}

const lorebookClassifierBase = {
  entriesJson: JSON.stringify([
    { id: 'e1', name: 'Fire Dragon', content: 'A mighty beast', keywords: 'dragon,fire' },
  ]),
}

// ===== Helper: minimal ContextChatEntry fixture =====

function makeChatEntry(overrides: {
  type: 'user_action' | 'narration' | 'system' | 'retry'
  content: string
  timeStart: string
}) {
  return {
    type: overrides.type,
    content: overrides.content,
    timeStart: overrides.timeStart,
  }
}

// ===== Tests =====

describe('classifier template', () => {
  it('renders character name from characters array', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      characters: [
        {
          name: 'Aria',
          relationship: 'companion',
          status: 'active',
          appearance: ['red hair', 'green eyes'],
          description: '',
          traits: [],
          tier: 1,
        },
      ],
    })
    expect(result).toContain('Aria')
    expect(result).toContain('companion')
    expect(result).toContain('red hair')
  })

  it('renders inactive character status', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      characters: [
        {
          name: 'Old Guard',
          relationship: '',
          status: 'deceased',
          appearance: [],
          description: '',
          traits: [],
          tier: 1,
        },
      ],
    })
    expect(result).toContain('[deceased]')
  })

  it('handles empty characters with (none)', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      characters: [],
    })
    expect(result).toContain('(none)')
  })

  it('renders beat title filtered to active/pending', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      storyBeats: [
        { title: 'Find the Key', description: 'A quest', type: 'quest', status: 'active' },
        { title: 'Old Quest', description: '', type: 'quest', status: 'completed' },
      ],
    })
    expect(result).toContain('Find the Key')
    expect(result).not.toContain('Old Quest')
  })

  it('renders chat history with ACTION prefix', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      chatHistory: [
        makeChatEntry({ type: 'user_action', content: 'I open the door', timeStart: 'Y1D3 09:30' }),
      ],
    })
    expect(result).toContain('[ACTION]')
    expect(result).toContain('at Y1D3 09:30')
    expect(result).toContain('I open the door')
  })

  it('renders chat history with NARRATIVE prefix', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      chatHistory: [
        makeChatEntry({ type: 'narration', content: 'The door swings open.', timeStart: '' }),
      ],
    })
    expect(result).toContain('[NARRATIVE]')
  })

  it('renders location names as comma-separated list', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      locations: [
        { name: 'Tavern', description: '', type: 'building', tier: 1 },
        { name: 'Market', description: '', type: 'district', tier: 1 },
      ],
    })
    expect(result).toContain('Tavern')
    expect(result).toContain('Market')
  })

  it('renders item names as comma-separated list', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      items: [{ name: 'Sword', description: '', type: 'weapon' }],
    })
    expect(result).toContain('Sword')
  })

  it('does not contain old scalar variable references', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, classifierBase)
    expect(result).not.toContain('{{ existingCharacters }}')
    expect(result).not.toContain('{{ existingBeats }}')
    expect(result).not.toContain('{{ chatHistoryBlock }}')
    expect(result).not.toContain('{{ existingLocations }}')
    expect(result).not.toContain('{{ existingItems }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...classifierBase,
      characters: [
        {
          name: 'Aria',
          relationship: 'companion',
          status: 'active',
          appearance: ['red hair'],
          description: '',
          traits: [],
          tier: 1,
        },
      ],
      storyBeats: [{ title: 'The Quest', description: 'Find it', type: 'quest', status: 'active' }],
      chatHistory: [
        makeChatEntry({ type: 'user_action', content: 'Go north', timeStart: 'Y1D1 08:00' }),
      ],
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('classifier template - runtimeVariables', () => {
  const withRuntimeVars = {
    ...classifierBase,
    runtimeVariables: {
      character: [
        {
          variableName: 'loyalty',
          variableType: 'number',
          minValue: 0,
          maxValue: 100,
          defaultValue: '50',
          description: 'Loyalty toward protagonist',
        },
        {
          variableName: 'mood',
          variableType: 'enum',
          enumOptions: [{ value: 'happy' }, { value: 'neutral' }, { value: 'hostile' }],
          defaultValue: 'neutral',
          description: 'Current emotional state',
        },
      ],
      item: [
        {
          variableName: 'durability',
          variableType: 'number',
          minValue: 0,
          maxValue: 100,
          defaultValue: undefined,
          description: 'Item condition as a percentage',
        },
      ],
    },
  }

  const withTextVar = {
    ...classifierBase,
    runtimeVariables: {
      character: [
        {
          variableName: 'backstory',
          variableType: 'text',
          defaultValue: undefined,
          description: 'Character background story',
        },
      ],
    },
  }

  it('renders ## Custom Variables to Track heading when runtimeVariables present', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('## Custom Variables to Track')
  })

  it('renders "character updates/new characters" label for character entity type', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('character updates/new characters')
  })

  it('renders "item updates/new items" label for item entity type', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('item updates/new items')
  })

  it('renders variable name and number range (loyalty and number 0-100)', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('loyalty')
    expect(result).toContain('number 0-100')
  })

  it('renders "required" when defaultValue is absent', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('required')
  })

  it('renders "optional" and "default: VALUE" when defaultValue is present', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('optional')
    expect(result).toContain('default: 50')
  })

  it('renders enum pipe-separated options (enum: happy|neutral|hostile)', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('enum: happy|neutral|hostile')
  })

  it('renders "text" fallback for text-type variable', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withTextVar)
    expect(result).toContain('text')
  })

  it('renders variable description after colon', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).toContain('Loyalty toward protagonist')
  })

  it('omits runtimeVariables section entirely when variable is absent from context', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, classifierBase)
    expect(result).not.toContain('## Custom Variables to Track')
  })

  it('does not contain [object Object] when runtimeVariables present', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).not.toContain('[object Object]')
  })
})

describe('style-reviewer template', () => {
  it('renders passage content from passages array', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...styleReviewerBase,
      passages: [{ content: 'The wind howled.', entryId: '1' }],
      passageCount: '1',
    })
    expect(result).toContain('The wind howled.')
  })

  it('renders passage number separator', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...styleReviewerBase,
      passages: [{ content: 'The wind howled.', entryId: '1' }],
      passageCount: '1',
    })
    expect(result).toContain('--- Passage 1 ---')
  })

  it('renders multiple passages with sequential numbers', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...styleReviewerBase,
      passages: [
        { content: 'The wind howled.', entryId: '1' },
        { content: 'Rain fell hard.', entryId: '2' },
      ],
      passageCount: '2',
    })
    expect(result).toContain('--- Passage 1 ---')
    expect(result).toContain('--- Passage 2 ---')
  })

  it('does not contain old {{ passages }} as raw Liquid', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, styleReviewerBase)
    expect(result).not.toContain('{{ passages }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...styleReviewerBase,
      passages: [{ content: 'The wind howled.', entryId: '1' }],
      passageCount: '1',
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('tier3-entry-selection template', () => {
  it('renders entry name from availableEntries array', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...tier3Base,
      availableEntries: [
        { name: 'Dragon Lore', type: 'concept', description: 'Ancient knowledge' },
      ],
    })
    expect(result).toContain('Dragon Lore')
    expect(result).toContain('[concept]')
    expect(result).toContain('Ancient knowledge')
  })

  it('renders 0-based index for entries', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...tier3Base,
      availableEntries: [
        { name: 'Dragon Lore', type: 'concept', description: 'Ancient knowledge' },
      ],
    })
    expect(result).toContain('0.')
  })

  it('renders recent entry content', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...tier3Base,
      recentEntries: [{ type: 'narration', content: 'The cave echoed.' }],
    })
    expect(result).toContain('The cave echoed.')
  })

  it('does not contain old scalar variable references', () => {
    const result = templateEngine.render(tier3Template.userContent!, tier3Base)
    expect(result).not.toContain('{{ entrySummaries }}')
    expect(result).not.toContain('{{ recentContent }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...tier3Base,
      availableEntries: [
        { name: 'Dragon Lore', type: 'concept', description: 'Ancient knowledge' },
      ],
      recentEntries: [{ type: 'narration', content: 'The cave echoed.' }],
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('lorebook-classifier template', () => {
  it('renders entriesJson content unmangled', () => {
    const result = templateEngine.render(
      lorebookClassifierTemplate.userContent!,
      lorebookClassifierBase,
    )
    expect(result).toContain('Fire Dragon')
    expect(result).toContain('A mighty beast')
  })

  it('rendered output contains valid JSON fragment', () => {
    const result =
      templateEngine.render(lorebookClassifierTemplate.userContent!, lorebookClassifierBase) ?? ''
    // Extract the JSON array portion from the rendered output
    const jsonStart = result.indexOf('[')
    const jsonEnd = result.lastIndexOf(']')
    expect(jsonStart).toBeGreaterThan(-1)
    expect(jsonEnd).toBeGreaterThan(jsonStart)
    const jsonFragment = result.slice(jsonStart, jsonEnd + 1)
    expect(() => JSON.parse(jsonFragment)).not.toThrow()
  })

  it('does not render {{ entriesJson }} as raw Liquid reference', () => {
    const result = templateEngine.render(
      lorebookClassifierTemplate.userContent!,
      lorebookClassifierBase,
    )
    expect(result).not.toContain('{{ entriesJson }}')
    expect(result).not.toContain('{{entriesJson}}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(
      lorebookClassifierTemplate.userContent!,
      lorebookClassifierBase,
    )
    expect(result).not.toContain('[object Object]')
  })
})
