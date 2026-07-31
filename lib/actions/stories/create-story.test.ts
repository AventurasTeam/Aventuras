import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  branches,
  clearEmbeddingStaleOp,
  compositeText,
  deltas,
  emptyEntityState,
  emptyWorkingState,
  ensureVecTables,
  entities,
  packFloat32,
  sourceHash,
  stories,
  storyEntries,
  upsertVecOps,
  wizardSessions,
  type SqlOp,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { StoryDefinition } from '@/lib/db/stories/story-config-schema'
import { buildStorySettings } from '@/lib/db/stories/story-settings-defaults'
import { EmbedderInitError, type EmbedderConfig } from '@/lib/embedder'

import { createStoryWithBranch } from './create-story'

// Mock only the embed helper at the module boundary; the real ops builders
// (upsertVecOps / clearEmbeddingStaleOp from @/lib/db) run against the harness.
vi.mock('@/lib/embedder', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, embedAndBuildVecOps: vi.fn() }
})

const { embedAndBuildVecOps } = await import('@/lib/embedder')
const mockedEmbed = vi.mocked(embedAndBuildVecOps)

const LOCAL_CONFIG: EmbedderConfig = {
  backend: 'local',
  modelId: 'Xenova/all-MiniLM-L6-v2',
  dim: 384,
}

const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'

const NO_APP_DEFAULTS = {
  defaultStorySettings: {},
  embeddingModelId: null,
  embeddingProviderId: null,
  defaultSuggestionCategories: { adventure: [], creative: [] },
}

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
  const { db, sqlite, runInTransaction } = await createTestDb()
  return { db, sqlite, ctx: { db, runInTransaction } }
}

beforeEach(() => {
  mockedEmbed.mockReset()
  mockedEmbed.mockResolvedValue([])
})

describe('createStoryWithBranch', () => {
  it('creative+third: atomic story+branch+opening with zero deltas', async () => {
    const { db, ctx } = await setup()

    const { storyId, branchId } = await createStoryWithBranch(
      {
        title: 'The Floating Isles',
        description: 'A grand tale',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
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
        settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
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
          settings: buildStorySettings('creative', NO_APP_DEFAULTS),
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
          settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
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
          settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
          openingContent: 'x',
          openingMetadata: metadata,
        },
        ctx,
        3000,
      ),
    ).rejects.toThrow()
  })

  it('replaceExistingStoryId promotes a draft: same id becomes active, draft session row is gone', async () => {
    const { db, ctx } = await setup()
    const draftId = 'story_draft'
    await db.insert(stories).values({
      id: draftId,
      title: 'Untitled story',
      status: 'draft',
      createdAt: 500,
      updatedAt: 500,
    })
    await db
      .insert(wizardSessions)
      .values({ id: draftId, storyId: draftId, state: emptyWorkingState(), updatedAt: 500 })

    const { storyId, branchId } = await createStoryWithBranch(
      {
        storyId: draftId,
        replaceExistingStoryId: true,
        title: 'Promoted Draft',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'The draft becomes real.',
        openingMetadata: metadata,
      },
      ctx,
      6000,
    )

    expect(storyId).toBe(draftId)
    const storyRows = await db.select().from(stories).where(eq(stories.id, draftId))
    expect(storyRows).toHaveLength(1)
    expect(storyRows[0]).toMatchObject({
      id: draftId,
      status: 'active',
      title: 'Promoted Draft',
      currentBranchId: branchId,
    })

    const sessionRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, draftId))
    expect(sessionRows).toHaveLength(0)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, draftId))
    expect(branchRows).toHaveLength(1)
    expect(await db.select().from(deltas)).toHaveLength(0)
  })

  it('replaceExistingStoryId promotion is all-or-nothing: a forced failure leaves the draft intact', async () => {
    const { db, ctx } = await setup()
    const draftId = 'story_draft_forced_fail'

    await db.insert(stories).values({
      id: draftId,
      title: 'Untitled story',
      status: 'draft',
      createdAt: 700,
      updatedAt: 700,
    })
    await db
      .insert(wizardSessions)
      .values({ id: draftId, storyId: draftId, state: emptyWorkingState(), updatedAt: 700 })
    // A branch already pointing at the draft (drafts never normally have one —
    // saveStoryDraft only ever writes a stories + wizard_sessions row) forces
    // the promotion's own `DELETE FROM stories` to hit the branches→stories FK,
    // aborting the whole ops array atomically instead of leaving the draft
    // half-deleted.
    await db
      .insert(branches)
      .values({ id: 'br_orphan', storyId: draftId, name: 'stray', createdAt: 1 })

    await expect(
      createStoryWithBranch(
        {
          storyId: draftId,
          replaceExistingStoryId: true,
          title: 'Should not land',
          definition: makeDefinition(),
          settings: buildStorySettings('creative', NO_APP_DEFAULTS),
          openingContent: 'x',
          openingMetadata: metadata,
        },
        ctx,
        8000,
      ),
    ).rejects.toThrow()

    const storyRows = await db.select().from(stories).where(eq(stories.id, draftId))
    expect(storyRows).toHaveLength(1)
    expect(storyRows[0].status).toBe('draft')

    const sessionRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, draftId))
    expect(sessionRows).toHaveLength(1)

    // The pre-existing (stray) branch survives untouched; no second branch,
    // no opening entry, was ever committed for it.
    const branchRows = await db.select().from(branches).where(eq(branches.storyId, draftId))
    expect(branchRows).toHaveLength(1)
    expect(branchRows[0].id).toBe('br_orphan')
    expect(await db.select().from(storyEntries)).toHaveLength(0)
  })
})

describe('createStoryWithBranch — embed step', () => {
  const DIM = 384

  function realVecOps() {
    mockedEmbed.mockImplementation(async (config, rows, exec) => {
      await ensureVecTables(DIM, exec)
      const ops: SqlOp[] = []
      for (const row of rows) {
        const text = compositeText(row.fields)
        ops.push(
          ...upsertVecOps({
            kind: row.kind,
            id: row.id,
            branchId: row.branchId,
            modelId: config.modelId,
            dim: DIM,
            sourceHash: sourceHash(text),
            vector: packFloat32(new Float32Array(DIM).fill(0.1)),
          }),
          clearEmbeddingStaleOp(row.kind, row.id, row.branchId),
        )
      }
      return ops
    })
  }

  it('embeds the lead: vec ops land after the entity insert and clear its stale flag', async () => {
    const { db, sqlite, ctx } = await setup()
    realVecOps()

    const captured: SqlOp[] = []
    const capturingCtx = {
      db,
      runInTransaction: async (ops: SqlOp[]) => {
        captured.push(...ops)
        return ctx.runInTransaction(ops)
      },
    }

    const { branchId } = await createStoryWithBranch(
      {
        title: 'Embedded',
        definition: makeDefinition({
          mode: 'adventure',
          narration: 'first',
          leadEntityId: LEAD_ID,
        }),
        settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
        openingContent: 'You wake.',
        openingMetadata: metadata,
        lead: { id: LEAD_ID, name: 'Aria' },
        embed: { config: LOCAL_CONFIG, exec: async (sql) => sqlite.exec(sql) },
      },
      capturingCtx,
      2000,
    )

    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    const entityInsertIdx = captured.findIndex((op) => /insert into "entities"/i.test(op.sql))
    const vecInsertIdx = captured.findIndex((op) => /entities_vec_384/i.test(op.sql))
    expect(entityInsertIdx).toBeGreaterThanOrEqual(0)
    expect(vecInsertIdx).toBeGreaterThan(entityInsertIdx)

    const vecRows = sqlite
      .prepare('select id from entities_vec_384 where branch_id = ?')
      .all(branchId) as { id: string }[]
    expect(vecRows).toHaveLength(1)
    expect(vecRows[0].id).toBe(LEAD_ID)

    const entityRow = sqlite
      .prepare('select embedding_stale from entities where id = ?')
      .get(LEAD_ID) as { embedding_stale: number }
    expect(entityRow.embedding_stale).toBe(0)
  })

  it('rolls back everything when the embed throws: no rows persist', async () => {
    const { db, ctx } = await setup()
    mockedEmbed.mockRejectedValue(new EmbedderInitError('embedder down'))

    await expect(
      createStoryWithBranch(
        {
          title: 'Doomed',
          definition: makeDefinition({
            mode: 'adventure',
            narration: 'first',
            leadEntityId: LEAD_ID,
          }),
          settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
          openingContent: 'You wake.',
          openingMetadata: metadata,
          lead: { id: LEAD_ID, name: 'Aria' },
          embed: { config: LOCAL_CONFIG, exec: async () => {} },
        },
        ctx,
        3000,
      ),
    ).rejects.toBeInstanceOf(EmbedderInitError)

    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(branches)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
  })

  it('skips the embed helper entirely when no embed input is supplied', async () => {
    const { ctx } = await setup()

    await createStoryWithBranch(
      {
        title: 'No embed',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'Once.',
        openingMetadata: metadata,
      },
      ctx,
      4000,
    )

    expect(mockedEmbed).not.toHaveBeenCalled()
  })
})
