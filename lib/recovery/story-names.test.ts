import { describe, expect, it } from 'vitest'

import { stories } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { BootRecoveryReport, RecoveredRun } from '@/lib/pipeline'

import { loadRecoveryStoryNames } from './story-names'

function recovered(storyId: string | null, runId: string): RecoveredRun {
  return {
    runId,
    kind: 'per-turn',
    actionId: `action_${runId}`,
    storyId,
    deltas: 1,
  }
}

describe('loadRecoveryStoryNames', () => {
  it('resolves distinct existing story IDs and ignores missing and null IDs', async () => {
    const { db } = await createTestDb()
    await db
      .insert(stories)
      .values({ id: 'story_1', title: 'Mornstone', createdAt: 1, updatedAt: 1 })
    const report: BootRecoveryReport = {
      reversed: [
        recovered('story_1', 'run_1'),
        recovered('story_1', 'run_2'),
        recovered('deleted', 'run_3'),
        recovered(null, 'run_4'),
      ],
      failures: [],
      heldStoryIds: [],
    }

    await expect(loadRecoveryStoryNames(report, db)).resolves.toEqual({
      story_1: 'Mornstone',
    })
  })

  // A held story with no orphan of its own still gets named in the copy.
  it('resolves a held story no run names', async () => {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_2', title: 'Vellaby', createdAt: 1, updatedAt: 1 })
    await expect(
      loadRecoveryStoryNames({ reversed: [], failures: [], heldStoryIds: ['story_2'] }, db),
    ).resolves.toEqual({ story_2: 'Vellaby' })
  })
})
