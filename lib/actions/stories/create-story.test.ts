import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, emptyEntityState, entities, stories, storyEntries } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { StoryDefinition } from '@/lib/db/stories/story-config-schema'
import { buildStorySettings } from '@/lib/db/stories/story-settings-defaults'

import { createStoryWithBranch } from './create-story'

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'

function makeDefinition(overrides: Partial<StoryDefinition> = {}): StoryDefinition {
  return {
    mode: 'creative',
    leadEntityId: null,
    narration: 'third',
    genre: { label: 'Fantasy', promptBody: 'high fantasy' },
    tone: { label: 'Epic', promptBody: 'grand and sweeping' },
    setting: 'A realm of floating isles',
    calendarSystemId: 'cal_default',
    worldTimeOrigin: { day: 0 },
    ...overrides,
  }
}

const metadata = { sceneEntities: [], currentLocationId: null, worldTime: 0 }

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  return { db, ctx: { db, runInTransaction } }
}

describe('createStoryWithBranch', () => {
  it('creative+third: atomic story+branch+opening with zero deltas', async () => {
    const { db, ctx } = await setup()

    const { storyId, branchId } = await createStoryWithBranch(
      {
        title: 'The Floating Isles',
        description: 'A grand tale',
        definition: makeDefinition(),
        settings: buildStorySettings({}, null),
        openingContent: 'Once upon a time',
        openingMetadata: metadata,
      },
      ctx,
      1000,
    )

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')
    expect(storyRow.currentBranchId).toBe(branchId)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    expect(branchRows).toHaveLength(1)
    expect(branchRows[0]).toMatchObject({ id: branchId, name: 'main' })

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchId))
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0]).toMatchObject({
      position: 1,
      kind: 'opening',
      content: 'Once upon a time',
    })

    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('adventure+first: writes the lead entity row', async () => {
    const { db, ctx } = await setup()

    const { branchId } = await createStoryWithBranch(
      {
        title: 'Aria Rising',
        definition: makeDefinition({
          mode: 'adventure',
          narration: 'first',
          leadEntityId: LEAD_ID,
        }),
        settings: buildStorySettings({}, null),
        openingContent: 'You wake at dawn.',
        openingMetadata: metadata,
        lead: { id: LEAD_ID, name: 'Aria' },
      },
      ctx,
      2000,
    )

    const entityRows = await db.select().from(entities).where(eq(entities.branchId, branchId))
    expect(entityRows).toHaveLength(1)
    expect(entityRows[0]).toMatchObject({
      id: LEAD_ID,
      kind: 'character',
      name: 'Aria',
      status: 'active',
      injectionMode: 'auto',
    })
    expect(entityRows[0].state).toEqual(emptyEntityState('character'))

    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('is all-or-nothing: a mid-commit failure leaves nothing behind', async () => {
    const { db, ctx } = await setup()
    const existingId = 'story_existing'
    await db
      .insert(stories)
      .values({ id: existingId, title: 'Existing', status: 'active', createdAt: 1, updatedAt: 1 })

    await expect(
      createStoryWithBranch(
        {
          storyId: existingId,
          title: 'Conflict',
          definition: makeDefinition(),
          settings: buildStorySettings({}, null),
          openingContent: 'boom',
          openingMetadata: metadata,
        },
        ctx,
        4000,
      ),
    ).rejects.toThrow()

    const storyRows = await db.select().from(stories)
    expect(storyRows).toHaveLength(1)
    expect(storyRows[0].id).toBe(existingId)
    expect(await db.select().from(branches)).toHaveLength(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('rejects a definition whose leadEntityId has no matching lead entity', async () => {
    const { db, ctx } = await setup()

    await expect(
      createStoryWithBranch(
        {
          title: 'Orphan lead',
          definition: makeDefinition({
            mode: 'adventure',
            narration: 'first',
            leadEntityId: LEAD_ID,
          }),
          settings: buildStorySettings({}, null),
          openingContent: 'x',
          openingMetadata: metadata,
        },
        ctx,
        5000,
      ),
    ).rejects.toThrow()

    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(branches)).toHaveLength(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('adventure with null leadEntityId is rejected by the definition schema', async () => {
    const { ctx } = await setup()

    await expect(
      createStoryWithBranch(
        {
          title: 'Broken',
          definition: makeDefinition({ mode: 'adventure', leadEntityId: null }),
          settings: buildStorySettings({}, null),
          openingContent: 'x',
          openingMetadata: metadata,
        },
        ctx,
        3000,
      ),
    ).rejects.toThrow()
  })
})
