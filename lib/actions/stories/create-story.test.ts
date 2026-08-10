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
  lore,
  packFloat32,
  sourceHash,
  stories,
  storyEntries,
  upsertVecOps,
  wizardSessions,
  type SqlOp,
  type WizardLoreDraft,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import type { StoryDefinition } from '@/lib/db/stories/story-config-schema'
import { buildStorySettings } from '@/lib/db/stories/story-settings-defaults'
import { EmbedderCallError, EmbedderInitError, type EmbedderConfig } from '@/lib/embedder'

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

function loreRow(overrides: Partial<WizardLoreDraft> = {}): WizardLoreDraft {
  return {
    id: 'lore_11111111-1111-1111-1111-111111111111',
    title: 'The Salt Wells',
    body: 'Nine wells ring the drowned coast.',
    category: '',
    tags: [],
    injectionMode: 'auto',
    priority: 0,
    ...overrides,
  }
}

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
          clearEmbeddingStaleOp(row),
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

  it('lore rows land with their More-options fields; an omitted category persists as NULL', async () => {
    const { db, ctx } = await setup()

    const rowA = loreRow({
      id: 'lore_11111111-1111-1111-1111-111111111111',
      title: 'The Salt Wells',
      body: 'Nine wells ring the drowned coast.',
      category: 'Geography',
      tags: ['coast', 'water'],
      injectionMode: 'always',
      priority: 42,
    })
    const rowB = loreRow({
      id: 'lore_22222222-2222-2222-2222-222222222222',
      title: 'The Hollow King',
      body: 'A ruler who cast no shadow.',
      category: '',
      tags: [],
      injectionMode: 'disabled',
      priority: 0,
    })

    const { branchId } = await createStoryWithBranch(
      {
        title: 'World-building',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'Once.',
        openingMetadata: metadata,
        lore: [rowA, rowB],
      },
      ctx,
      9000,
    )

    const loreRows = await db.select().from(lore).where(eq(lore.branchId, branchId))
    expect(loreRows).toHaveLength(2)

    const a = loreRows.find((r) => r.id === rowA.id)
    expect(a).toMatchObject({
      title: 'The Salt Wells',
      body: 'Nine wells ring the drowned coast.',
      category: 'Geography',
      injectionMode: 'always',
      priority: 42,
    })
    expect(a?.tags).toEqual(['coast', 'water'])
    expect(a?.keywords).toEqual([])

    const b = loreRows.find((r) => r.id === rowB.id)
    expect(b?.category).toBeNull()
    expect(b?.injectionMode).toBe('disabled')
    expect(b?.keywords).toEqual([])
  })

  it('embeds the lead and lore in one batched call, not one per row', async () => {
    const { ctx } = await setup()
    const row = loreRow({ title: 'Magic', body: 'Wells.' })

    const { branchId } = await createStoryWithBranch(
      {
        title: 'Combined',
        definition: makeDefinition({
          mode: 'adventure',
          narration: 'first',
          leadEntityId: LEAD_ID,
        }),
        settings: buildStorySettings('adventure', NO_APP_DEFAULTS),
        openingContent: 'You wake.',
        openingMetadata: metadata,
        lead: { id: LEAD_ID, name: 'Aria' },
        lore: [row],
        embed: { config: LOCAL_CONFIG, exec: async () => {} },
      },
      ctx,
      9100,
    )

    expect(mockedEmbed).toHaveBeenCalledTimes(1)
    expect(mockedEmbed.mock.calls[0][1]).toEqual([
      { kind: 'entity', id: LEAD_ID, branchId, fields: ['Aria', null] },
      { kind: 'lore', id: row.id, branchId, fields: ['Magic', 'Wells.'] },
    ])
  })

  it('lore INSERTs precede the spliced lore vec ops and clear the stale flag', async () => {
    const { db, sqlite, ctx } = await setup()
    realVecOps()
    const row = loreRow({ title: 'The Deep Archive', body: 'Kept below the tide line.' })

    const captured: SqlOp[] = []
    const capturingCtx = {
      db,
      runInTransaction: async (ops: SqlOp[]) => {
        captured.push(...ops)
        return ctx.runInTransaction(ops)
      },
    }

    await createStoryWithBranch(
      {
        title: 'Archived',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'Once.',
        openingMetadata: metadata,
        lore: [row],
        embed: { config: LOCAL_CONFIG, exec: async (sql) => sqlite.exec(sql) },
      },
      capturingCtx,
      9200,
    )

    const loreInsertIdx = captured.findIndex((op) => /insert into "lore"/i.test(op.sql))
    const vecInsertIdx = captured.findIndex((op) => /lore_vec_384/i.test(op.sql))
    expect(loreInsertIdx).toBeGreaterThanOrEqual(0)
    expect(vecInsertIdx).toBeGreaterThan(loreInsertIdx)

    const loreRowAfter = sqlite
      .prepare('select embedding_stale from lore where id = ?')
      .get(row.id) as { embedding_stale: number }
    expect(loreRowAfter.embedding_stale).toBe(0)
  })

  it('a failing embed with a lore row rolls back: no story, no lore', async () => {
    const { db, ctx } = await setup()
    mockedEmbed.mockRejectedValue(new EmbedderCallError('vec table ensure failed'))
    const row = loreRow()

    await expect(
      createStoryWithBranch(
        {
          title: 'Doomed World',
          definition: makeDefinition(),
          settings: buildStorySettings('creative', NO_APP_DEFAULTS),
          openingContent: 'Once.',
          openingMetadata: metadata,
          lore: [row],
          embed: { config: LOCAL_CONFIG, exec: async () => {} },
        },
        ctx,
        9300,
      ),
    ).rejects.toBeInstanceOf(EmbedderCallError)

    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(lore)).toHaveLength(0)
  })

  it('embed supplied but no lead and no lore: the helper is skipped, no vec DDL runs', async () => {
    const { sqlite, ctx } = await setup()
    const execd: string[] = []

    await createStoryWithBranch(
      {
        title: 'Nothing to embed',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'Once.',
        openingMetadata: metadata,
        embed: {
          config: LOCAL_CONFIG,
          exec: async (sql) => {
            execd.push(sql)
            sqlite.exec(sql)
          },
        },
      },
      ctx,
      9700,
    )

    expect(mockedEmbed).not.toHaveBeenCalled()
    expect(execd).toHaveLength(0)
  })

  it('draft-promote carrying lore: rows land on the new branch under its own PK; a same-id row on another branch is untouched', async () => {
    const { db, sqlite, ctx } = await setup()
    realVecOps()
    const draftId = 'story_draft_with_lore'
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

    // A pre-existing OTHER story already holding a lore row under the SAME id
    // on a different branch — the composite PK is (branch_id, id).
    const otherBranch = 'br_other'
    await db
      .insert(stories)
      .values({ id: 'story_other', title: 'Other', status: 'active', createdAt: 1, updatedAt: 1 })
    await db
      .insert(branches)
      .values({ id: otherBranch, storyId: 'story_other', name: 'main', createdAt: 1 })
    const sharedLoreId = 'lore_11111111-1111-1111-1111-111111111111'
    await db.insert(lore).values({
      id: sharedLoreId,
      branchId: otherBranch,
      title: 'Pre-existing',
      body: 'untouched',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    const { storyId, branchId } = await createStoryWithBranch(
      {
        storyId: draftId,
        replaceExistingStoryId: true,
        title: 'Promoted With Lore',
        definition: makeDefinition(),
        settings: buildStorySettings('creative', NO_APP_DEFAULTS),
        openingContent: 'The draft becomes real.',
        openingMetadata: metadata,
        lore: [loreRow({ id: sharedLoreId, category: 'Geography' })],
        embed: { config: LOCAL_CONFIG, exec: async (sql) => sqlite.exec(sql) },
      },
      ctx,
      9500,
    )

    expect(storyId).toBe(draftId)
    const storyRows = await db.select().from(stories).where(eq(stories.id, draftId))
    expect(storyRows[0]).toMatchObject({ status: 'active', currentBranchId: branchId })
    expect(
      await db.select().from(wizardSessions).where(eq(wizardSessions.id, draftId)),
    ).toHaveLength(0)

    const promoted = await db.select().from(lore).where(eq(lore.branchId, branchId))
    expect(promoted).toHaveLength(1)
    expect(promoted[0]).toMatchObject({
      id: sharedLoreId,
      category: 'Geography',
      embeddingStale: 0,
    })

    const untouched = await db.select().from(lore).where(eq(lore.branchId, otherBranch))
    expect(untouched).toHaveLength(1)
    expect(untouched[0].title).toBe('Pre-existing')

    const vecRows = sqlite
      .prepare('select branch_id from lore_vec_384 where id = ?')
      .all(sharedLoreId) as { branch_id: string }[]
    expect(vecRows.map((r) => r.branch_id)).toEqual([branchId])
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
