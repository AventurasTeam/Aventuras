import { describe, it, expect } from 'vitest'
import { templateEngine } from '$lib/services/templates/engine'
import { PROMPT_TEMPLATES } from '$lib/services/prompts/templates/index'
import { promptContext, promptContextMinimal } from '../../../../../src/test/fixtures/promptContext'

// ===== Template lookups =====

const classifierTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'classifier')!
const styleReviewerTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'style-reviewer')!
const tier3Template = PROMPT_TEMPLATES.find((t) => t.id === 'tier3-entry-selection')!
const lorebookClassifierTemplate = PROMPT_TEMPLATES.find((t) => t.id === 'lorebook-classifier')!

// ===== Tests =====

describe('classifier template', () => {
  it('renders character name from characters array', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Aria')
    expect(result).toContain('companion')
    expect(result).toContain('Silver hair')
  })

  it('renders inactive character status', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
      characters: [
        {
          ...promptContext.characters[0],
          name: 'Old Guard',
          relationship: '',
          status: 'deceased',
        },
      ],
    })
    expect(result).toContain('[deceased]')
  })

  it('handles empty characters with (none)', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).toContain('(none)')
  })

  it('renders beat title filtered to active/pending', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Find the Lost Temple')
    expect(result).not.toContain('Defeated the Wolves')
  })

  it('renders storyEntriesVisible with ACTION prefix', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('[ACTION]')
    expect(result).toContain('at Year 1, Day 42, 14:5')
    expect(result).toContain('I draw my sword and step cautiously forward.')
  })

  it('renders storyEntriesVisible with NARRATIVE prefix', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('[NARRATIVE]')
  })

  it('renders time display from entry timeStart', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('at Year 1, Day 42, 14:0')
  })

  it('renders location names', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Thornwood Edge')
    expect(result).toContain('Sunken Temple')
  })

  it('renders item names', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('Iron Sword')
    expect(result).toContain('Health Potion')
  })

  it('does not contain old scalar variable references', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ chatHistoryBlock }}')
    expect(result).not.toContain('{{ existingCharacters }}')
    expect(result).not.toContain('{{ existingBeats }}')
    expect(result).not.toContain('{{ existingLocations }}')
    expect(result).not.toContain('{{ existingItems }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('classifier template - runtimeVariables', () => {
  const withRuntimeVars = {
    ...promptContext,
    packVariables: {
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
    },
  }

  const withTextVar = {
    ...promptContext,
    packVariables: {
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
    const ctx = { ...promptContext, packVariables: {} }
    const result = templateEngine.render(classifierTemplate.userContent!, ctx)
    expect(result).not.toContain('## Custom Variables to Track')
  })

  it('does not contain [object Object] when runtimeVariables present', () => {
    const result = templateEngine.render(classifierTemplate.userContent!, withRuntimeVars)
    expect(result).not.toContain('[object Object]')
  })
})

describe('style-reviewer template', () => {
  it('renders passage content from storyEntriesVisible narration entries', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain(
      'The torches flickered against the stone walls of the ancient chamber.',
    )
  })

  it('renders passage number separator', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('--- Passage 1 ---')
  })

  it('renders multiple passages with sequential numbers', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...promptContext,
    })
    // promptContext has 2 narration entries (e1, e3) and 1 user_action (e2)
    expect(result).toContain('--- Passage 1 ---')
    expect(result).toContain('--- Passage 2 ---')
  })

  it('does not contain old {{ passages }} as raw Liquid', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...promptContextMinimal,
    })
    expect(result).not.toContain('{{ passages }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(styleReviewerTemplate.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('tier3-entry-selection template', () => {
  it('renders entry name from loreEntriesForTier3', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('The Shadow Guild')
    expect(result).toContain('[faction]')
    expect(result).toContain('A secretive criminal organization.')
  })

  it('renders 0-based index for entries', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...promptContext,
    })
    expect(result).toContain('0.')
  })

  it('renders recent entry content from storyEntries', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...promptContext,
    })
    expect(result).toContain(
      'The torches flickered against the stone walls of the ancient chamber.',
    )
  })

  it('does not contain old scalar variable references', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('{{ entrySummaries }}')
    expect(result).not.toContain('{{ recentContent }}')
  })

  it('does not contain [object Object]', () => {
    const result = templateEngine.render(tier3Template.userContent!, {
      ...promptContext,
    })
    expect(result).not.toContain('[object Object]')
  })
})

describe('lorebook-classifier template', () => {
  const lorebookClassifierBase = {
    entriesJson: JSON.stringify([
      { id: 'e1', name: 'Fire Dragon', content: 'A mighty beast', keywords: 'dragon,fire' },
    ]),
  }

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
