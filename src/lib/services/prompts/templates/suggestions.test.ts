import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbMockRef = vi.hoisted(() => ({ current: null as any }))

vi.mock('$lib/services/database', () => ({
  get database() {
    return dbMockRef.current
  },
}))

import {
  renderTemplate,
  createTemplateTestMock,
  testVariableInjection,
  testManifestCoverage,
} from '$test/helpers/templateTestHelper'
import { promptContext, promptContextMinimal } from '$test/fixtures/promptContext'
import { suggestionsManifest } from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

describe('suggestions', () => {
  describe('variable injection', () => {
    testVariableInjection(suggestionsManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('lorebook section absent when lorebookEntries empty', async () => {
      const result = await renderTemplate('suggestions', promptContextMinimal)
      expect(result.user).not.toContain('## Lorebook/World Elements')
    })

    it('lorebook section present when lorebookEntries has items', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).toContain('## Lorebook/World Elements')
    })

    it('active threads section present when storyBeats has active/pending items', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).toContain('Find the Lost Temple')
    })

    it('active threads absent when storyBeats empty', async () => {
      const result = await renderTemplate('suggestions', promptContextMinimal)
      expect(result.user).not.toContain('Find the Lost Temple')
    })
  })

  describe('array iteration', () => {
    it('renders recent story entries (sliced to last 5)', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).toContain('[DIRECTION]')
      expect(result.user).toContain('[NARRATIVE]')
    })

    it('renders lorebook entry names, types, descriptions', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).toContain('The Shadow Guild')
      expect(result.user).toContain('faction')
    })
  })

  describe('filter behavior', () => {
    it('| where filters storyBeats to active/pending only', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).not.toContain('Defeated the Wolves')
    })

    it('| slice limits lorebook entries to maxForSuggestions', async () => {
      const manyEntries = Array.from({ length: 20 }, (_, i) => ({
        name: `Entry${i}`,
        type: 'concept',
        description: `Desc${i}`,
      }))
      const result = await renderTemplate('suggestions', {
        ...promptContext,
        retrievalResult: {
          ...promptContext.retrievalResult,
          lorebookEntries: manyEntries,
        },
      })
      expect(result.user).toContain('Entry0')
      expect(result.user).toContain('Entry4')
      expect(result.user).not.toContain('Entry5')
    })
  })

  describe('edge cases', () => {
    it('renders without crash with empty context', async () => {
      const result = await renderTemplate('suggestions', {})
      expect(result.system.length).toBeGreaterThan(0)
    })

    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('suggestions', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// manifest coverage
// ---------------------------------------------------------------------------

describe('manifest coverage', () => {
  testManifestCoverage(suggestionsManifest)
})
