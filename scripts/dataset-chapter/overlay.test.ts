import type { AssistantModelMessage, ToolCallPart } from 'ai'
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { startManualClose } from '@/lib/actions/chapters/start-manual-close'
import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { loadOpenStory } from '@/lib/actions/stories/operational'
import { undoLastAction } from '@/lib/actions/story-entries/undo'
import type {
  generateStructured,
  generateToolStep,
  ToolStep,
  ToolStepCall,
  ToolStepResult,
} from '@/lib/ai'
import {
  chapters,
  deltas,
  entities,
  storyEntries,
  threads,
  type DbCtx,
  type Entity,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { buildSeedSteps } from '@/lib/db/devtools/seed-dataset'
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { metadataReplyResult } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { identityTask } from '@/lib/pipeline/definitions/close-agent/identity'
import { CloseIds } from '@/lib/pipeline/definitions/close-agent/ids'
import { __setCloseAgentSlots } from '@/lib/pipeline/definitions/close-agent/slots'
import { hydrateAppSettings } from '@/lib/stores'

import { applyDatasetOverlay, DATASET_BRANCH_ID, overlayCappedLists } from './overlay'
import { DATASET_OVERLAY } from './overlay-data'
import { datasetStorySteps, seedAppRefs } from '../seed/dataset-story'
import { insertSeedSteps } from '../seed/insert'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

const B = DATASET_BRANCH_ID
const JIM = 'char_25b8a728-1ab9-4ee6-994d-0a44dd2ea897'
const LIVESEY = 'char_82275468-0258-40b1-865e-fdac2268b847'
const SILVER = 'char_7f241601-a656-4302-9163-d3333b59ffb6'
const TRELAWNEY = 'char_ca888ce4-6fed-48d5-9489-388ae1b09f77'
const BUCCANEERS = 'fact_893030a8-baf7-4b38-a97d-0737a6551fd9'
const SMOLLETT = 'char_b85d2052-0e0d-4204-a392-3939b3a6bb60'
const ARROW = 'char_a5a12e97-7110-4da5-8323-cd50cf8076de'
const JIMS_MOTHER = 'char_63bb1bc7-324c-4175-9ca5-4aff07db8646'
const LAST_REPLY = 'entry_0b671b00-385b-49a2-8343-13edf5e1d5c2'
// Jim meets Long John at the Spy-glass: "intelligent and smiling".
const SPY_GLASS = 'entry_ef35f3d4-025d-4a4d-98e7-7bdb5dad65ea'
const FIRST = 1_900_000_000_000
const SECOND = FIRST + 60_000

const OVERLAID = DATASET_OVERLAY.entities.map(({ id }) => id)

// The probe's shape: one provider and profile behind lore-mgmt.
const MODELS = {
  providers: [
    {
      id: 'prov_overlay',
      type: 'openai-compatible',
      displayName: 'Local',
      apiKey: 'k',
      endpoint: 'http://localhost:4319/v1',
      favoriteModelIds: [],
    },
  ],
  profiles: [
    {
      id: 'prof_overlay',
      kind: 'agent',
      name: 'Close',
      modelRef: { providerId: 'prov_overlay', modelId: 'close-model' },
    },
  ],
  assignments: { 'lore-mgmt': 'prof_overlay' },
  defaultProviderId: 'prov_overlay',
  diagnostics: { enabled: false, debug_level_enabled: false },
}

const USAGE: ToolStep['usage'] = {
  inputTokens: 30_000,
  inputTokenDetails: { noCacheTokens: 30_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 200,
  outputTokenDetails: { textTokens: 200, reasoningTokens: 0 },
  totalTokens: 30_200,
}

function toolStep(calls: readonly ToolStepCall[]): ToolStepResult {
  const message: AssistantModelMessage = {
    role: 'assistant',
    content:
      calls.length === 0
        ? [{ type: 'text', text: 'Done.' }]
        : calls.map((call): ToolCallPart => ({ type: 'tool-call', ...call })),
  }
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [message],
      text: calls.length === 0 ? 'Done.' : '',
      finishReason: calls.length === 0 ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

beforeEach(() => {
  resetSingletons()
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
  generateToolStepMock.mockReset()
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function seededDataset(): Promise<DbCtx> {
  const { db, runInTransaction } = await createTestDb()
  const defaults = buildSeedSteps()
  await insertSeedSteps(db, [...defaults, ...datasetStorySteps(seedAppRefs(defaults))])
  return { db, runInTransaction }
}

const entityRows = (ctx: DbCtx, ids: readonly string[]) =>
  ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, B), inArray(entities.id, [...ids])))
    .orderBy(asc(entities.id))

const byId = (rows: readonly Entity[]) => new Map(rows.map((row) => [row.id, row]))

async function overlaidState(ctx: DbCtx) {
  return {
    entities: await entityRows(ctx, OVERLAID),
    planted: await ctx.db
      .select()
      .from(threads)
      .where(and(eq(threads.branchId, B), eq(threads.id, DATASET_OVERLAY.plantedThread.row.id))),
  }
}

async function chapterCount(ctx: DbCtx): Promise<number> {
  const [row] = await ctx.db.select({ n: count() }).from(chapters).where(eq(chapters.branchId, B))
  return row!.n
}

async function openEntryCount(ctx: DbCtx): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, B), isNull(storyEntries.chapterId)))
  return row!.n
}

async function deltaCount(ctx: DbCtx): Promise<number> {
  const [row] = await ctx.db.select({ n: count() }).from(deltas).where(eq(deltas.branchId, B))
  return row!.n
}

const userEdits = (ctx: DbCtx) =>
  ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, B), eq(deltas.source, 'user_edit'), eq(deltas.targetId, SILVER)))

async function undoSeedClose(ctx: DbCtx): Promise<void> {
  expect(await loadOpenStory(B, ctx)).toMatchObject({ status: 'ok' })
  expect(await undoLastAction(B, ctx)).toEqual({ status: 'ok' })
}

// The close shows the chapter's turns as t1…tN by position, and the chapter is every open entry.
async function turnHandle(ctx: DbCtx, entryId: string): Promise<string> {
  const open = await ctx.db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(and(eq(storyEntries.branchId, B), isNull(storyEntries.chapterId)))
    .orderBy(asc(storyEntries.position))
  const at = open.findIndex(({ id }) => id === entryId)
  if (at < 0) throw new Error(`${entryId} is not in the open chapter`)
  return `t${at + 1}`
}

function shownHandle(show: MockInstance<CloseIds['show']>, id: string): string {
  const at = show.mock.calls.findIndex(([shown]) => shown === id)
  const result = at < 0 ? undefined : show.mock.results[at]
  if (result?.type !== 'return') throw new Error(`the close showed no handle for ${id}`)
  return result.value
}

const unedited = (row: Entity) => ({
  name: row.name,
  kind: row.kind,
  status: row.status,
  keywords: row.keywords,
  description: row.id === DATASET_OVERLAY.userEdit.id ? 'user-edited' : row.description,
})

describe('the dataset overlay', () => {
  it('lists the rows it leaves at or over a soft cap, and the faction it gives members', () => {
    expect(overlayCappedLists()).toEqual([
      { id: JIM, list: 'traits', length: 10 },
      { id: LIVESEY, list: 'traits', length: 8 },
      { id: SILVER, list: 'traits', length: 8 },
      { id: TRELAWNEY, list: 'drives', length: 6 },
      { id: BUCCANEERS, list: 'agenda', length: 4 },
    ])
    const members = DATASET_OVERLAY.entities.flatMap((entry) =>
      entry.kind === 'character' && entry.state.faction_id === BUCCANEERS ? [entry.name] : [],
    )
    expect(members).toEqual(['Black Dog', 'Pew', 'Dirk', 'Johnny'])
  })

  it("reopens the seed's closed chapter, then writes the overlay and logs the user edit", async () => {
    const ctx = await seededDataset()
    expect(await chapterCount(ctx)).toBe(1)

    expect(await applyDatasetOverlay(ctx)).toEqual({ reopened: true, userEdit: 'logged' })

    expect(await chapterCount(ctx)).toBe(0)
    expect(await openEntryCount(ctx)).toBe(133)
    const rows = byId(await entityRows(ctx, OVERLAID))
    for (const entry of DATASET_OVERLAY.entities)
      expect(rows.get(entry.id)?.state, entry.name).toMatchObject(entry.state)
    for (const { id, list, length } of overlayCappedLists())
      expect((rows.get(id)?.state as Record<string, unknown>)[list], id).toHaveLength(length)
    expect(rows.get(SILVER)?.description).toBe(DATASET_OVERLAY.userEdit.description)
    expect(await userEdits(ctx)).toEqual([
      expect.objectContaining({ targetTable: 'entities', op: 'update', entryId: null }),
    ])
    expect((await overlaidState(ctx)).planted).toEqual([
      { ...DATASET_OVERLAY.plantedThread.row, branchId: B },
    ])
  })

  it('merges each state over the stored one and leaves the bare characters bare', async () => {
    const ctx = await seededDataset()
    await undoSeedClose(ctx)
    const watched = [...OVERLAID, SMOLLETT, ARROW, JIMS_MOTHER]
    const before = byId(await entityRows(ctx, watched))

    expect(await applyDatasetOverlay(ctx)).toEqual({ reopened: false, userEdit: 'logged' })

    const after = byId(await entityRows(ctx, watched))
    for (const entry of DATASET_OVERLAY.entities) {
      const was = before.get(entry.id)!
      const now = after.get(entry.id)!
      expect(now.state, entry.name).toEqual({ ...was.state, ...entry.state })
      expect(unedited(now), entry.name).toEqual(unedited(was))
    }
    for (const id of [SMOLLETT, ARROW, JIMS_MOTHER]) expect(after.get(id)).toEqual(before.get(id))
  })

  it('changes nothing when applied again, and logs its user edit once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const ctx = await seededDataset()
    vi.setSystemTime(FIRST)
    await applyDatasetOverlay(ctx)
    const once = await overlaidState(ctx)
    const logged = await deltaCount(ctx)
    expect(once.entities.map((row) => row.updatedAt)).toEqual(OVERLAID.map(() => FIRST))

    vi.setSystemTime(SECOND)
    expect(await applyDatasetOverlay(ctx)).toEqual({ reopened: false, userEdit: 'restated' })

    expect(await overlaidState(ctx)).toEqual(once)
    expect(await deltaCount(ctx)).toBe(logged)
    expect(await userEdits(ctx)).toHaveLength(1)
  })

  it("is restored by a close's CTRL-Z", { timeout: 30_000 }, async () => {
    const ctx = await seededDataset()
    await applyDatasetOverlay(ctx)
    const overlaid = await overlaidState(ctx)
    expect(await hydrateAppSettings(async () => MODELS)).toMatchObject({ status: 'ok' })
    const show = vi.spyOn(CloseIds.prototype, 'show')
    __setCloseAgentSlots({ before: [], perPart: [{ kind: 'task', def: identityTask }], after: [] })
    const turn = await turnHandle(ctx, SPY_GLASS)
    const traits = [
      'old sailor',
      'man of substance',
      "has a banker's account",
      'lost a leg',
      'intelligent and smiling',
      'keeps a public-house in Bristol',
      'knows every seaman in Bristol',
      "ship's cook of the Hispaniola",
    ]
    let sent = 0
    generateToolStepMock.mockImplementation(async () => {
      sent += 1
      if (sent > 1) return toolStep([])
      return toolStep([
        {
          toolCallId: 'call_1',
          toolName: 'update_character',
          input: {
            id: shownHandle(show, SILVER),
            traits,
            turns: [turn],
            why: 'At the Spy-glass he is intelligent and smiling, and one-legged repeats lost a leg.',
          },
        },
      ])
    })

    const tx = expectRan(await startManualClose(B, LAST_REPLY, ctx))

    expect(tx).toMatchObject({ outcome: 'completed' })
    const [, request] = generateToolStepMock.mock.calls[0]!
    expect(request.prompt.user).toContain(shownHandle(show, SILVER))
    expect(request.prompt.user).toContain('Long John Silver')
    const [closed] = await ctx.db
      .select({ report: chapters.closeReport })
      .from(chapters)
      .where(eq(chapters.branchId, B))
    expect(closed?.report).toMatchObject({
      calls: [{ task: 'identity', tool: 'update_character', result: 'ok' }],
    })
    expect(byId(await entityRows(ctx, [SILVER])).get(SILVER)?.state).toMatchObject({ traits })

    expect(await undoLastAction(B, ctx)).toEqual({ status: 'ok' })

    expect(await chapterCount(ctx)).toBe(0)
    expect(await overlaidState(ctx)).toEqual(overlaid)
  })

  it('refuses a closed chapter whose close is not the last action to undo', async () => {
    const ctx = await seededDataset()
    expect(await loadOpenStory(B, ctx)).toMatchObject({ status: 'ok' })
    const edit = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'user_edit',
          payload: { branchId: B, id: SMOLLETT, patch: { description: 'A sharp-looking man.' } },
        },
        actionId: 'act_overlay_test_edit',
        branchId: B,
      },
      ctx,
    )
    expect(edit.status).toBe('ok')

    await expect(applyDatasetOverlay(ctx)).rejects.toThrow(/last action to undo/)

    expect(await chapterCount(ctx)).toBe(1)
  })

  it('throws on a seed row whose name it does not know, before writing the overlay', async () => {
    const ctx = await seededDataset()
    await ctx.db
      .update(entities)
      .set({ name: 'Barbecue' })
      .where(and(eq(entities.branchId, B), eq(entities.id, SILVER)))

    await expect(applyDatasetOverlay(ctx)).rejects.toThrow(/"Barbecue".*"Long John Silver"/)

    expect(byId(await entityRows(ctx, [JIM])).get(JIM)?.state).toMatchObject({ traits: [] })
  })

  it('throws on a seed that holds the user edit with no user edit logged, before writing', async () => {
    const ctx = await seededDataset()
    await ctx.db
      .update(entities)
      .set({ description: DATASET_OVERLAY.userEdit.description })
      .where(and(eq(entities.branchId, B), eq(entities.id, SILVER)))

    await expect(applyDatasetOverlay(ctx)).rejects.toThrow(/no user edit/)

    expect(byId(await entityRows(ctx, [JIM])).get(JIM)?.state).toMatchObject({ traits: [] })
    expect(await userEdits(ctx)).toEqual([])
  })

  it('throws when the thread the planted one repeats is no longer active, before writing', async () => {
    const ctx = await seededDataset()
    await undoSeedClose(ctx)
    await ctx.db
      .update(threads)
      .set({ status: 'resolved' })
      .where(
        and(eq(threads.branchId, B), eq(threads.id, DATASET_OVERLAY.plantedThread.duplicates.id)),
      )

    await expect(applyDatasetOverlay(ctx)).rejects.toThrow(/no active thread on the branch/)

    expect(byId(await entityRows(ctx, [JIM])).get(JIM)?.state).toMatchObject({ traits: [] })
    expect((await overlaidState(ctx)).planted).toEqual([])
  })

  it('throws on a held planted thread whose written fields differ, and ignores bookkeeping', async () => {
    const ctx = await seededDataset()
    await applyDatasetOverlay(ctx)
    const planted = DATASET_OVERLAY.plantedThread.row.id
    const atPlanted = and(eq(threads.branchId, B), eq(threads.id, planted))
    await ctx.db.update(threads).set({ embeddingStale: 0, updatedAt: SECOND }).where(atPlanted)

    expect(await applyDatasetOverlay(ctx)).toEqual({ reopened: false, userEdit: 'restated' })

    await ctx.db.update(threads).set({ status: 'active' }).where(atPlanted)

    await expect(applyDatasetOverlay(ctx)).rejects.toThrow(new RegExp(planted))
    expect((await overlaidState(ctx)).planted).toMatchObject([{ status: 'active' }])
  })
})
