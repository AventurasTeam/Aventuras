import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

import { renderTemplate, createTemplateTestMock, testVariableInjection } from '$test/helpers/templateTestHelper'
import { promptContext, promptContextMinimal } from '$test/fixtures/promptContext'
import {
  classifierManifest,
  lorebookClassifierManifest,
  styleReviewerManifest,
  tier3EntrySelectionManifest,
} from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// classifier
// ---------------------------------------------------------------------------

describe('classifier', () => {
  describe('variable injection', () => {
    testVariableInjection(classifierManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('handles empty characters with (none)', async () => {
      const result = await renderTemplate('classifier', promptContextMinimal)
      expect(result.user).toContain('(none)')
    })

    it('renders active beats, filters out completed', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).toContain('Find the Lost Temple')
      expect(result.user).not.toContain('Defeated the Wolves')
    })

    it('runtimeVariables section present when packVariables.runtimeVariables set', async () => {
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
            ],
          },
        },
      }
      const result = await renderTemplate('classifier', withRuntimeVars)
      expect(result.user).toContain('## Custom Variables to Track')
      expect(result.user).toContain('loyalty')
      expect(result.user).toContain('number 0-100')
    })

    it('runtimeVariables section absent when packVariables empty', async () => {
      const result = await renderTemplate('classifier', {
        ...promptContext,
        packVariables: {},
      })
      expect(result.user).not.toContain('## Custom Variables to Track')
    })
  })

  describe('conditional branches', () => {
    it('renders "Player Action" label in adventure mode', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).toContain('Player Action')
    })

    it('renders "Author Direction" label in creative-writing mode', async () => {
      const result = await renderTemplate('classifier', {
        ...promptContext,
        mode: 'creative-writing',
      })
      expect(result.user).toContain('Author Direction')
    })
  })

  describe('array iteration', () => {
    it('renders storyEntriesVisible with ACTION/NARRATIVE prefixes', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).toContain('[ACTION]')
      expect(result.user).toContain('[NARRATIVE]')
    })

    it('renders character visual descriptors', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).toContain('Silver pendant')
      expect(result.user).toContain('Angular features, bronze skin')
    })

    it('renders inactive character status label', async () => {
      const result = await renderTemplate('classifier', {
        ...promptContext,
        characters: [{ ...promptContext.characters[0], name: 'Old Guard', status: 'deceased' }],
      })
      expect(result.user).toContain('[deceased]')
    })

    it('renders time display from entry metadata', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).toContain('at Year 1, Day 42, 14:0')
    })

    it('renders enum runtime variables with pipe-separated options', async () => {
      const result = await renderTemplate('classifier', {
        ...promptContext,
        packVariables: {
          runtimeVariables: {
            character: [
              {
                variableName: 'mood',
                variableType: 'enum',
                enumOptions: [{ value: 'happy' }, { value: 'neutral' }, { value: 'hostile' }],
                defaultValue: 'neutral',
                description: 'Current emotional state',
              },
            ],
          },
        },
      })
      expect(result.user).toContain('enum: happy|neutral|hostile')
    })
  })

  describe('edge cases', () => {
    it('does not contain old scalar variable references', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).not.toContain('{{ chatHistoryBlock }}')
      expect(result.user).not.toContain('{{ existingCharacters }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('classifier', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// lorebook-classifier
// ---------------------------------------------------------------------------

describe('lorebook-classifier', () => {
  describe('variable injection', () => {
    testVariableInjection(lorebookClassifierManifest, promptContext)
  })

  describe('filter behavior', () => {
    it('rendered output contains valid JSON fragment', async () => {
      const result = await renderTemplate('lorebook-classifier', promptContext)
      const jsonStart = result.user.indexOf('[')
      const jsonEnd = result.user.lastIndexOf(']')
      expect(jsonStart).toBeGreaterThan(-1)
      const jsonFragment = result.user.slice(jsonStart, jsonEnd + 1)
      expect(() => JSON.parse(jsonFragment)).not.toThrow()
    })
  })

  describe('edge cases', () => {
    it('does not render raw Liquid reference', async () => {
      const result = await renderTemplate('lorebook-classifier', promptContext)
      expect(result.user).not.toContain('{{ entriesJson }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('lorebook-classifier', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// style-reviewer
// ---------------------------------------------------------------------------

describe('style-reviewer', () => {
  describe('variable injection', () => {
    testVariableInjection(styleReviewerManifest, promptContext)
  })

  describe('array iteration', () => {
    it('renders passage numbers as separators', async () => {
      const result = await renderTemplate('style-reviewer', promptContext)
      expect(result.user).toContain('--- Passage 1 ---')
      expect(result.user).toContain('--- Passage 2 ---')
    })
  })

  describe('filter behavior', () => {
    it('| where filters to narration entries only', async () => {
      const result = await renderTemplate('style-reviewer', promptContext)
      // user_action content should not appear as a passage
      expect(result.user).not.toContain('I draw my sword')
    })
  })

  describe('edge cases', () => {
    it('does not contain raw {{ passages }} literal', async () => {
      const result = await renderTemplate('style-reviewer', promptContextMinimal)
      expect(result.user).not.toContain('{{ passages }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('style-reviewer', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// tier3-entry-selection
// ---------------------------------------------------------------------------

describe('tier3-entry-selection', () => {
  describe('variable injection', () => {
    testVariableInjection(tier3EntrySelectionManifest, promptContext)
  })

  describe('array iteration', () => {
    it('renders entry name with 0-based index', async () => {
      const result = await renderTemplate('tier3-entry-selection', promptContext)
      expect(result.user).toContain('0.')
      expect(result.user).toContain('[faction]')
    })

    it('renders recent story entry content', async () => {
      const result = await renderTemplate('tier3-entry-selection', promptContext)
      expect(result.user).toContain('The torches flickered')
    })
  })

  describe('filter behavior', () => {
    it('| truncate clips description to 100 characters', async () => {
      const longDesc = 'X'.repeat(200)
      const result = await renderTemplate('tier3-entry-selection', {
        ...promptContext,
        loreEntriesForTier3: [{ type: 'concept', name: 'Test', description: longDesc }],
      })
      expect(result.user).not.toContain(longDesc)
      expect(result.user).toContain('...')
    })
  })

  describe('edge cases', () => {
    it('does not contain old scalar variable references', async () => {
      const result = await renderTemplate('tier3-entry-selection', promptContext)
      expect(result.user).not.toContain('{{ entrySummaries }}')
      expect(result.user).not.toContain('{{ recentContent }}')
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('tier3-entry-selection', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})
