import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  BIND_CHUNK,
  branchCopyOps,
  branches,
  deltas,
  reversalJournals,
  stories,
  storyEntries,
  type DbCtx,
  type Delta,
  type NewEntity,
  type RerunJournal,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { applyDeltaAction } from '../delta/apply-delta-action'
import { __resetBranchWriteLocks } from '../delta/branch-write-lock'
import { buildReverseAndPrunePlan, type ReversePlan } from '../delta/reverse-replay'
import { resolveSweep, type ResolvedSweep } from '../story-entries/operational'
import type { PipelineAction } from '../types'
import { forkSurvivorPredicates, type SurvivorPredicates } from './fork-survivors'

type TestDb = Awaited<ReturnType<typeof createTestDb>>

const STORY = 's_fork'
const PARENT = 'br_fork_parent'
const CHILD = 'br_fork_child'
const AT = 1_767_225_600_000
const N = 'ent_fork_n'
const B = 'ent_fork_b'
const C = 'ent_fork_c'
const DANGLING = 'dlt_fork_dangling'

let t: TestDb
let ctx: DbCtx

const metadata = (worldTime: number) => ({ sceneEntities: [], currentLocationId: null, worldTime })

const entryCreate = (
  id: string,
  position: number,
  kind: 'user_action' | 'ai_reply',
): PipelineAction => ({
  kind: 'createStoryEntry',
  source: kind === 'user_action' ? 'user_edit' : 'ai_classifier',
  payload: {
    entry: {
      id,
      branchId: PARENT,
      position,
      kind,
      content: id,
      metadata: metadata(position),
      createdAt: AT + position,
    },
  },
})

const character = (id: string): NewEntity => ({
  id,
  branchId: PARENT,
  kind: 'character',
  name: id,
  status: 'active',
  injectionMode: 'auto',
  createdAt: AT,
  updatedAt: AT,
})

const journal = (chapterId: string): RerunJournal => ({
  version: 1,
  chapterId,
  chapterNumber: 1,
  floor: 0,
  rows: [],
  deltas: [],
  journals: [],
})

async function act(actionId: string, entryId: string | null, action: PipelineAction) {
  const result = await applyDeltaAction({ action, actionId, branchId: PARENT, entryId }, ctx)
  if (result.status !== 'ok') throw new Error(`${actionId} did not land: ${JSON.stringify(result)}`)
}

async function seedParent(): Promise<void> {
  await ctx.db.insert(stories).values({ id: STORY, title: 'Fork', createdAt: AT, updatedAt: AT })
  await ctx.db.insert(branches).values({ id: PARENT, storyId: STORY, name: 'main', createdAt: AT })
  await ctx.db.insert(storyEntries).values({
    id: 'ent_fork_open',
    branchId: PARENT,
    position: 1,
    kind: 'opening',
    content: 'open',
    metadata: metadata(0),
    createdAt: AT,
  })
  const createCharacter = (id: string): PipelineAction => ({
    kind: 'createEntity',
    source: 'user_edit',
    payload: { entry: character(id) },
  })
  await act('act_world', null, createCharacter('char_fork_a'))
  await act('act_world', null, createCharacter('char_fork_b'))
  await act('act_t1', N, entryCreate(N, 2, 'ai_reply'))
  await act('act_t2', B, entryCreate(B, 3, 'user_action'))
  await act('act_t2', C, entryCreate(C, 4, 'ai_reply'))
  await act('act_pass', C, {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: { entry: character('char_fork_new') },
  })
  await act('act_pass', C, {
    kind: 'upsertCharacterRelationship',
    source: 'periodic_classifier',
    payload: {
      branchId: PARENT,
      subjectId: 'char_fork_a',
      objectId: 'char_fork_b',
      kind: 'rival',
      proseEntryId: null,
    },
  })
  await act('act_keep', N, {
    kind: 'upsertCharacterRelationship',
    source: 'user_edit',
    payload: {
      branchId: PARENT,
      subjectId: 'char_fork_a',
      objectId: 'char_fork_b',
      kind: 'rival',
      inverseKind: 'mentor',
    },
  })
  await act('act_touch', N, {
    kind: 'updateEntity',
    source: 'user_edit',
    payload: { branchId: PARENT, id: 'char_fork_new', patch: { name: 'Corin' } },
  })
  await ctx.db.insert(reversalJournals).values([
    { actionId: 'act_pass', branchId: PARENT, journal: journal('chap_fork_pass'), createdAt: AT },
    { actionId: 'act_world', branchId: PARENT, journal: journal('chap_fork_world'), createdAt: AT },
  ])
  const { top } = t.sqlite
    .prepare('SELECT max(log_position) AS top FROM deltas WHERE branch_id = ?')
    .get(PARENT) as { top: number }
  await ctx.db.insert(deltas).values({
    id: DANGLING,
    branchId: PARENT,
    entryId: 'ent_fork_gone',
    actionId: 'act_dangling',
    logPosition: top + 1,
    source: 'user_edit',
    targetTable: 'entities',
    targetId: 'char_fork_a',
    op: 'update',
    undoPayload: { name: 'char_fork_a' },
    createdAt: AT,
  })
}

beforeEach(async () => {
  generationStore.__reset()
  undoRedoStore.__reset()
  t = await createTestDb()
  ctx = { db: t.db, runInTransaction: t.runInTransaction }
  await seedParent()
})

afterEach(() => {
  __resetBranchWriteLocks()
  entitiesStore.__reset()
  entriesStore.__reset()
  generationStore.__reset()
  undoRedoStore.__reset()
})

async function planFork(): Promise<{ swept: ResolvedSweep; plan: ReversePlan }> {
  const swept = await resolveSweep(PARENT, B, ctx)
  if ('status' in swept) throw new Error(`sweep refused: ${swept.reason}`)
  const plan = await buildReverseAndPrunePlan(
    swept.set,
    ctx,
    { keepRedoExact: false },
    { writeBranchId: CHILD },
  )
  return { swept, plan }
}

async function copyToChild(predicates: SurvivorPredicates): Promise<void> {
  await ctx.runInTransaction([
    ctx.db
      .insert(branches)
      .values({
        id: CHILD,
        storyId: STORY,
        parentBranchId: PARENT,
        forkEntryId: N,
        name: 'fork',
        createdAt: AT + 10,
      })
      .toSQL(),
    ...(await branchCopyOps(ctx.db, { from: PARENT, to: CHILD, mode: 'fork', where: predicates })),
  ])
}

function deltaIdsOn(branchId: string): string[] {
  const rows = t.sqlite
    .prepare('SELECT id FROM deltas WHERE branch_id = ? ORDER BY id')
    .all(branchId) as { id: string }[]
  return rows.map((row) => row.id)
}

function journalIdsOn(branchId: string): string[] {
  const rows = t.sqlite
    .prepare('SELECT action_id FROM reversal_journals WHERE branch_id = ? ORDER BY action_id')
    .all(branchId) as { action_id: string }[]
  return rows.map((row) => row.action_id)
}

describe('forkSurvivorPredicates', () => {
  it('copies everything when the fork entry is the tail', () => {
    expect(forkSurvivorPredicates(null)).toEqual({ deltas: 'all', reversal_journals: 'all' })
  })

  it("copies every delta but the plan's prune set and every journal but its dropped ones", async () => {
    const { swept, plan } = await planFork()
    const windowIds = new Set(swept.window.map((d) => d.id))
    const prunedIds = plan.prunedDeltas.map((d) => d.id)
    // Each part of the predicate has a row to decide.
    expect(plan.prunedDeltas.filter((d) => !windowIds.has(d.id)).map((d) => d.actionId)).toEqual([
      'act_touch',
    ])
    expect(plan.reownedDeltas.map((d) => [d.actionId, d.targetTable, windowIds.has(d.id)])).toEqual(
      [['act_pass', 'character_relationships', true]],
    )
    expect(plan.droppedJournals.map((j) => j.actionId)).toEqual(['act_pass'])
    expect(windowIds.has(DANGLING)).toBe(false)
    expect(swept.set.rows.map((d) => d.id)).not.toContain(DANGLING)
    const parentDeltas = deltaIdsOn(PARENT)

    await copyToChild(forkSurvivorPredicates({ swept, plan }))

    expect(deltaIdsOn(CHILD)).toEqual(parentDeltas.filter((id) => !prunedIds.includes(id)))
    expect(deltaIdsOn(CHILD)).toContain(DANGLING)
    expect(journalIdsOn(CHILD)).toEqual(['act_world'])
    expect(deltaIdsOn(PARENT)).toEqual(parentDeltas)
    expect(journalIdsOn(PARENT)).toEqual(['act_pass', 'act_world'])
  })

  it('omits each empty list, copying every delta outside the window', async () => {
    const { swept, plan } = await planFork()
    const predicates = forkSurvivorPredicates({
      swept,
      plan: { ...plan, prunedDeltas: swept.window, reownedDeltas: [], droppedJournals: [] },
    })
    const windowIds = swept.window.map((d) => d.id)

    expect(predicates.reversal_journals).toBe('all')
    await copyToChild(predicates)

    expect(deltaIdsOn(CHILD)).toEqual(deltaIdsOn(PARENT).filter((id) => !windowIds.includes(id)))
    expect(deltaIdsOn(CHILD)).toContain(DANGLING)
    expect(journalIdsOn(CHILD)).toEqual(['act_pass', 'act_world'])
  })

  it('throws when a window row is outside the reversal set', async () => {
    const { swept, plan } = await planFork()
    const [dangling] = (await ctx.db
      .select()
      .from(deltas)
      .where(and(eq(deltas.branchId, PARENT), eq(deltas.id, DANGLING)))) as Delta[]

    expect(() =>
      forkSurvivorPredicates({ swept: { ...swept, window: [...swept.window, dangling] }, plan }),
    ).toThrow(`window delta ${DANGLING} is not in the reversal set`)
  })

  it('throws past the bind limit rather than binding the lists', async () => {
    const { swept, plan } = await planFork()
    const [dropped] = plan.droppedJournals
    const droppedJournals = Array.from({ length: BIND_CHUNK }, (_, i) => ({
      ...dropped,
      actionId: `act_j${i}`,
    }))

    expect(() => forkSurvivorPredicates({ swept, plan: { ...plan, droppedJournals } })).toThrow(
      `1 pruned outside the window, 1 re-owned in it and ${BIND_CHUNK} dropped journals`,
    )
  })
})
