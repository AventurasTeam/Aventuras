import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

import { renderTemplate, createTemplateTestMock, testVariableInjection, testManifestCoverage } from '$test/helpers/templateTestHelper'
import { promptContext, promptContextMinimal } from '$test/fixtures/promptContext'
import {
  chapterAnalysisManifest,
  chapterSummarizationManifest,
  agenticRetrievalManifest,
  interactiveLorebookManifest,
  loreManagementManifest,
} from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// chapter-analysis
// ---------------------------------------------------------------------------

describe('chapter-analysis', () => {
  describe('variable injection', () => {
    testVariableInjection(chapterAnalysisManifest, promptContext)
  })

  describe('array iteration', () => {
    it('renders all analysisEntries with sequential Message IDs', async () => {
      const result = await renderTemplate('chapter-analysis', promptContext)
      expect(result.user).toContain('[Message 1]')
      expect(result.user).toContain('[Message 2]')
      expect(result.user).toContain('[Message 3]')
    })

    it('renders entry type labels (user_action / narration)', async () => {
      const result = await renderTemplate('chapter-analysis', promptContext)
      expect(result.user).toContain('user_action')
      expect(result.user).toContain('narration')
    })
  })

  describe('filter behavior', () => {
    it('| plus computes correct firstValidId from lastChapterEndIndex', async () => {
      const result = await renderTemplate('chapter-analysis', {
        ...promptContext,
        lastChapterEndIndex: 10,
      })
      expect(result.user).toContain('[Message 11]')
    })
  })

  describe('edge cases', () => {
    it('renders without crash with minimal context', async () => {
      const result = await renderTemplate('chapter-analysis', promptContextMinimal)
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('chapter-analysis', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// chapter-summarization
// ---------------------------------------------------------------------------

describe('chapter-summarization', () => {
  describe('variable injection', () => {
    testVariableInjection(chapterSummarizationManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('Previous chapters header present when chapters exist', async () => {
      const result = await renderTemplate('chapter-summarization', promptContext)
      expect(result.user).toContain('Previous chapters:')
    })

    it('Previous chapters header absent when chapters empty', async () => {
      const result = await renderTemplate('chapter-summarization', promptContextMinimal)
      expect(result.user).not.toContain('Previous chapters:')
    })
  })

  describe('array iteration', () => {
    it('renders all chapter entries with type labels', async () => {
      const result = await renderTemplate('chapter-summarization', promptContext)
      expect(result.user).toContain('The hero arrived at dawn.')
      expect(result.user).toContain('I search the room carefully.')
      expect(result.user).toContain('Hidden behind a tapestry was a narrow passage.')
    })
  })

  describe('filter behavior', () => {
    it('| sort: "number" orders chapters correctly', async () => {
      const result = await renderTemplate('chapter-summarization', promptContext)
      const ch1Idx = result.user.indexOf('Chapter 1')
      const ch2Idx = result.user.indexOf('Chapter 2')
      expect(ch1Idx).toBeLessThan(ch2Idx)
    })
  })

  describe('edge cases', () => {
    it('renders without crash with minimal context', async () => {
      const result = await renderTemplate('chapter-summarization', promptContextMinimal)
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('chapter-summarization', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// agentic-retrieval
// ---------------------------------------------------------------------------

describe('agentic-retrieval', () => {
  describe('variable injection', () => {
    testVariableInjection(agenticRetrievalManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('renders "No chapters available." fallback when agenticChapters empty', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContextMinimal)
      expect(result.user).toContain('No chapters available.')
    })

    it('renders chapters list when agenticChapters has items', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContext)
      expect(result.user).toContain('Chapter 1')
    })

    it('renders "No entries available." fallback when agenticEntries empty', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContextMinimal)
      expect(result.user).toContain('No entries available.')
    })
  })

  describe('array iteration', () => {
    it('renders all agenticEntries with 0-based index', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContext)
      expect(result.user).toContain('0.')
      expect(result.user).toContain('[faction]')
      expect(result.user).toContain('The Shadow Guild')
    })

    it('renders recent story entries', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContext)
      expect(result.user).toContain('The torches flickered')
    })
  })

  describe('filter behavior', () => {
    it('| truncate clips chapter summary to configured limit', async () => {
      const longSummary = 'A'.repeat(200)
      const result = await renderTemplate('agentic-retrieval', {
        ...promptContext,
        chapters: [{ number: 1, title: 'Test', summary: longSummary }],
        userSettings: {
          ...promptContext.userSettings,
          agenticRetrieval: {
            ...promptContext.userSettings.agenticRetrieval,
            summaryCharLimit: 100,
          },
        },
      })
      expect(result.user).toContain('...')
      expect(result.user.indexOf(longSummary)).toBe(-1)
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })

    it('system content renders without variables', async () => {
      const result = await renderTemplate('agentic-retrieval', promptContextMinimal)
      expect(result.system.length).toBeGreaterThan(0)
    })
  })
})

// ---------------------------------------------------------------------------
// interactive-lorebook
// ---------------------------------------------------------------------------

describe('interactive-lorebook', () => {
  describe('variable injection', () => {
    testVariableInjection(interactiveLorebookManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('Active Context section present when focusedEntity set', async () => {
      const result = await renderTemplate('interactive-lorebook', promptContext)
      expect(result.system).toContain('## Active Context')
    })

    it('Active Context section absent when focusedEntity null', async () => {
      const result = await renderTemplate('interactive-lorebook', {
        ...promptContext,
        focusedEntity: null,
      })
      expect(result.system).not.toContain('## Active Context')
    })

    it('renders exact Active Context wording with entity details', async () => {
      const result = await renderTemplate('interactive-lorebook', {
        ...promptContext,
        focusedEntity: {
          entityType: 'lorebook',
          entityName: 'World Atlas',
          entityId: 'lb-999',
        },
      })
      expect(result.system).toContain('The user opened this assistant from the lorebook editor for')
      expect(result.system).toContain('"World Atlas"')
      expect(result.system).toContain('lb-999')
    })
  })

  describe('edge cases', () => {
    it('renders with all counts zero and no focused entity', async () => {
      const result = await renderTemplate('interactive-lorebook', {
        characterCount: 0,
        lorebookCount: 0,
        totalEntryCount: 0,
        scenarioCount: 0,
        focusedEntity: null,
      })
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('interactive-lorebook', promptContext)
      expect(result.system).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// lore-management
// ---------------------------------------------------------------------------

describe('lore-management', () => {
  describe('variable injection', () => {
    testVariableInjection(loreManagementManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('renders "No chapters available." when loreChapters empty', async () => {
      const result = await renderTemplate('lore-management', {
        ...promptContext,
        loreChapters: [],
      })
      expect(result.user).toContain('No chapters available.')
    })

    it('renders chapter summaries when loreChapters has items', async () => {
      const result = await renderTemplate('lore-management', promptContext)
      expect(result.user).not.toContain('No chapters available.')
    })
  })

  describe('array iteration', () => {
    it('renders all loreEntries with 0-based index, type, name, and description', async () => {
      const result = await renderTemplate('lore-management', promptContext)
      expect(result.user).toContain('[0]')
      expect(result.user).toContain('[faction]')
      expect(result.user).toContain('The Shadow Guild')
      expect(result.user).toContain('A secretive criminal organization.')
      expect(result.user).toContain('[1]')
      expect(result.user).toContain('[character]')
      expect(result.user).toContain('Elder Dragon')
    })

    it('renders all loreChapters with number, title, and summary', async () => {
      const result = await renderTemplate('lore-management', promptContext)
      expect(result.user).toContain('Chapter 1')
      expect(result.user).toContain('Into the Woods')
      expect(result.user).toContain('The party ventured into the Thornwood')
    })
  })

  describe('edge cases', () => {
    it('renders without crash with empty entries and chapters', async () => {
      const result = await renderTemplate('lore-management', {
        loreEntries: [],
        loreChapters: [],
      })
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('lore-management', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// manifest coverage
// ---------------------------------------------------------------------------

describe('manifest coverage', () => {
  testManifestCoverage(chapterAnalysisManifest)
  testManifestCoverage(chapterSummarizationManifest)
  testManifestCoverage(agenticRetrievalManifest)
  testManifestCoverage(interactiveLorebookManifest)
  testManifestCoverage(loreManagementManifest)
})
