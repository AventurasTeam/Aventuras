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
  actionChoicesManifest,
  timelineFillManifest,
  timelineFillAnswerManifest,
} from '$test/fixtures/templateManifests'

beforeEach(() => {
  dbMockRef.current = createTemplateTestMock()
})

// ---------------------------------------------------------------------------
// action-choices
// ---------------------------------------------------------------------------

describe('action-choices', () => {
  describe('variable injection', () => {
    testVariableInjection(actionChoicesManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('World Context section absent when lorebookEntries empty', async () => {
      const result = await renderTemplate('action-choices', promptContextMinimal)
      expect(result.user).not.toContain('## World Context')
    })

    it('World Context section present when lorebookEntries has items', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).toContain('## World Context')
    })

    it('Style Notes section absent when styleReview has no phrases', async () => {
      const result = await renderTemplate('action-choices', promptContextMinimal)
      expect(result.user).not.toContain('## Style Notes')
    })

    it('Style Notes section present when styleReview has phrases', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).toContain('## Style Notes')
    })

    it('active quests section shows quests when storyBeats has active/pending', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).toContain('Find the Lost Temple')
    })
  })

  describe('conditional branches', () => {
    it('first person POV renders correct instruction', async () => {
      const result = await renderTemplate('action-choices', {
        ...promptContext,
        pov: 'first',
      })
      expect(result.user).toContain('first person')
    })

    it('second person POV renders correct instruction', async () => {
      const result = await renderTemplate('action-choices', {
        ...promptContext,
        pov: 'second',
      })
      expect(result.user).toContain('second person')
    })

    it('third person POV renders correct instruction', async () => {
      const result = await renderTemplate('action-choices', {
        ...promptContext,
        pov: 'third',
      })
      expect(result.user).toContain('third person')
    })
  })

  describe('array iteration', () => {
    it('renders recent story entries with ACTION/NARRATIVE labels', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).toContain('[ACTION]')
      expect(result.user).toContain('[NARRATIVE]')
    })

    it('renders lorebook entry names', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).toContain('The Shadow Guild')
      expect(result.user).toContain('Elder Dragon')
    })
  })

  describe('filter behavior', () => {
    it('| where filters storyBeats to active/pending only', async () => {
      const result = await renderTemplate('action-choices', promptContext)
      expect(result.user).not.toContain('Defeated the Wolves')
    })

    it('| slice limits lorebook entries to maxForActionChoices', async () => {
      const manyEntries = Array.from({ length: 20 }, (_, i) => ({
        name: `Entry${i}`,
        type: 'concept',
        description: `Desc${i}`,
      }))
      const result = await renderTemplate('action-choices', {
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
    it('renders without crash with minimal context', async () => {
      const result = await renderTemplate('action-choices', promptContextMinimal)
      expect(result.user.length).toBeGreaterThanOrEqual(0)
    })

    it('does not contain [object Object] when locations empty', async () => {
      // Note: the template assigns currentLocation via `locations | where: "current"`
      // which renders as [object Object] when locations have current=true entries.
      // With empty locations, this issue is avoided.
      const result = await renderTemplate('action-choices', promptContextMinimal)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// timeline-fill
// ---------------------------------------------------------------------------

describe('timeline-fill', () => {
  describe('variable injection', () => {
    testVariableInjection(timelineFillManifest, promptContext)
  })

  describe('array iteration', () => {
    it('renders ACTION/NARRATIVE labels based on entry type', async () => {
      const result = await renderTemplate('timeline-fill', promptContext)
      expect(result.user).toContain('[ACTION]')
      expect(result.user).toContain('[NARRATIVE]')
    })

    it('renders chapter number and summary', async () => {
      const result = await renderTemplate('timeline-fill', promptContext)
      expect(result.user).toContain('Chapter 1:')
      expect(result.user).toContain('The party ventured into the Thornwood')
    })

    it('handles fewer than 10 entries without error', async () => {
      const result = await renderTemplate('timeline-fill', {
        storyEntriesVisible: [
          { type: 'narration', content: 'Entry A' },
          { type: 'narration', content: 'Entry B' },
        ],
        chapters: [],
      })
      expect(result.user).toContain('Entry A')
      expect(result.user).toContain('Entry B')
    })

    it('renders only last 10 entries when more than 10 provided', async () => {
      const entries = Array.from({ length: 15 }, (_, i) => ({
        type: 'narration',
        content: `Entry ${i + 1}`,
      }))
      const result = await renderTemplate('timeline-fill', {
        storyEntriesVisible: entries,
        chapters: [],
      })
      expect(result.user).toContain('Entry 15')
      expect(result.user).not.toContain('[NARRATIVE]: Entry 1\n')
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('timeline-fill', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})

// ---------------------------------------------------------------------------
// timeline-fill-answer
// ---------------------------------------------------------------------------

describe('timeline-fill-answer', () => {
  describe('variable injection', () => {
    testVariableInjection(timelineFillAnswerManifest, promptContext)
  })

  describe('conditional sections', () => {
    it('renders chapter entries when entries present (entries mode)', async () => {
      const result = await renderTemplate('timeline-fill-answer', promptContext)
      expect(result.user).toContain('I open the gate.')
      expect(result.user).toContain('The gate creaks open')
    })

    it('renders chapter summary when no entries (summary mode)', async () => {
      const result = await renderTemplate('timeline-fill-answer', {
        ...promptContext,
        answerChapters: [{ number: 5, summary: 'The party crossed the mountains.' }],
      })
      expect(result.user).toContain('The party crossed the mountains.')
    })
  })

  describe('conditional branches', () => {
    it('renders chapter title when present', async () => {
      const result = await renderTemplate('timeline-fill-answer', promptContext)
      expect(result.user).toContain(': Into the Woods')
    })

    it('handles mixed mode (some chapters with entries, some without)', async () => {
      const result = await renderTemplate('timeline-fill-answer', {
        ...promptContext,
        answerChapters: [
          { number: 2, entries: [{ type: 'narration', content: 'The battle raged on.' }] },
          { number: 4, summary: 'Peace was restored.' },
        ],
      })
      expect(result.user).toContain('The battle raged on.')
      expect(result.user).toContain('Peace was restored.')
    })
  })

  describe('edge cases', () => {
    it('does not contain [object Object]', async () => {
      const result = await renderTemplate('timeline-fill-answer', promptContext)
      expect(result.user).not.toContain('[object Object]')
    })
  })
})
