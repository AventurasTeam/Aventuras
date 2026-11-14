import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import type { ResolveModelConfig } from '@/lib/ai'
import { chapters, emptyEntityState, entities, happeningAwareness, happenings } from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'

import { closePhaseContext } from './agent-loop'
import type { PhaseContext } from '../../../types'
import type { CloseFixture } from '../../__tests__/close-fixture'
import { setCloseRange } from '../../close-intermediates'
import type { CloseRange } from '../../intermediates'
import { CloseIds } from '../ids'
import type { TaskPromptContext } from '../task'

// Real `prefix_<uuid>` ids: CloseIds hands handles for those only.
export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const ARIA = `char_${uuid(1)}`
export const JORIN = `char_${uuid(2)}`
export const MARA = `char_${uuid(3)}`
export const FIGHT = `hap_${uuid(11)}`
export const TOLL = `hap_${uuid(12)}`
export const RUMOUR = `hap_${uuid(13)}`
export const A_CHAPTER = `haw_${uuid(41)}`
export const A_BOTH = `haw_${uuid(42)}`
export const A_FREQUENT = `haw_${uuid(43)}`
export const A_IDLE = `haw_${uuid(44)}`
export const A_COMMON = `haw_${uuid(45)}`
export const CHAPTER = `chap_${uuid(50)}`
export const SUMMARY = 'Wren crosses at night and Jorin fights the toll men on the landing.'
// Counts no other text in the prompt holds, so finding one means a count leaked (3d).
export const COUNTS = { both: 4409, frequent: 7919, common: 6271 } as const

/** The chapter: the second turn to the third reply, t1…t4 by position; E is that reply. */
export const chapterOf = (fx: CloseFixture): string[] => fx.entries.slice(3, 7).map(({ id }) => id)
export const endOf = (fx: CloseFixture): string => fx.entries[6]!.id
const rangeOf = (fx: CloseFixture): CloseRange => ({
  chapterId: CHAPTER,
  startEntryId: fx.entries[3]!.id,
  endEntryId: endOf(fx),
})

// Written with no delta, as an import leaves a row: no edit history precedes it.
export async function putCharacter(fx: CloseFixture, id: string, name: string): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id,
    branchId: fx.branchId,
    kind: 'character',
    name,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    state: emptyEntityState('character'),
    keywords: [],
    createdAt: 1,
    updatedAt: 1,
  })
}

export async function putHappening(
  fx: CloseFixture,
  row: {
    id: string
    title: string
    description?: string
    occurredAtEntryId: string | null
    commonKnowledge?: 0 | 1
    /** The fixture's branch unless given. */
    branchId?: string
  },
): Promise<void> {
  await fx.ctx.db.insert(happenings).values({
    id: row.id,
    branchId: row.branchId ?? fx.branchId,
    title: row.title,
    description: row.description ?? null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: row.occurredAtEntryId,
    commonKnowledge: row.commonKnowledge ?? 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

export async function putAwareness(
  fx: CloseFixture,
  row: {
    id: string
    characterId: string
    happeningId: string
    learnedAtEntryId: string | null
    decayResistance: number | null
    retrievalCount?: number
    source?: string
  },
): Promise<void> {
  await fx.ctx.db.insert(happeningAwareness).values({
    id: row.id,
    branchId: fx.branchId,
    happeningId: row.happeningId,
    characterId: row.characterId,
    learnedAtEntryId: row.learnedAtEntryId,
    decayResistance: row.decayResistance,
    retrievalCount: row.retrievalCount ?? 0,
    source: row.source ?? null,
  })
}

/** The user's Plot-panel write of a pair: a create, or an update of the fields sent. */
export async function userWritesAwareness(
  fx: CloseFixture,
  {
    branchId = fx.branchId,
    ...fields
  }: {
    branchId?: string
    characterId: string
    happeningId: string
    decayResistance?: number
    source?: string
    retrievalCount?: number
  },
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'upsertHappeningAwareness',
        source: 'user_edit',
        payload: { branchId, ...fields, proseEntryId: null },
      },
      actionId: generateId('act'),
      branchId,
      entryId: null,
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`user awareness write refused: ${result.reason}`)
}

// The chapter being closed, as the metadata phase writes it before the agent runs.
export async function putChapter(fx: CloseFixture): Promise<void> {
  await fx.ctx.db.insert(chapters).values({
    id: CHAPTER,
    branchId: fx.branchId,
    sequenceNumber: 2,
    title: 'The crossing',
    summary: SUMMARY,
    theme: 'a guarded passage',
    keywords: [],
    startEntryId: fx.entries[3]!.id,
    endEntryId: endOf(fx),
    tokenCount: 1,
    closedAt: 1,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  })
}

/**
 * Fight: Aria learned at t2, Jorin at t3 (also most retrieved). Jorin's toll row predates the
 * chapter, most retrieved, unpinned; Mara's never retrieved; Aria's rumour row is common knowledge.
 */
export async function seedAwarenessWorld(fx: CloseFixture): Promise<void> {
  await putChapter(fx)
  await putCharacter(fx, ARIA, 'Aria')
  await putCharacter(fx, JORIN, 'Jorin')
  await putCharacter(fx, MARA, 'Mara')
  await putHappening(fx, {
    id: FIGHT,
    title: 'A fight at the ferry',
    occurredAtEntryId: fx.entries[4]!.id,
  })
  await putHappening(fx, { id: TOLL, title: 'The new toll', occurredAtEntryId: fx.entries[1]!.id })
  await putHappening(fx, {
    id: RUMOUR,
    title: 'Word of the toll',
    occurredAtEntryId: fx.entries[2]!.id,
    commonKnowledge: 1,
  })
  await putAwareness(fx, {
    id: A_CHAPTER,
    characterId: ARIA,
    happeningId: FIGHT,
    learnedAtEntryId: fx.entries[4]!.id,
    decayResistance: 0.6,
    source: 'saw it',
  })
  await putAwareness(fx, {
    id: A_BOTH,
    characterId: JORIN,
    happeningId: FIGHT,
    learnedAtEntryId: fx.entries[5]!.id,
    decayResistance: 0,
    retrievalCount: COUNTS.both,
    source: 'fought in it',
  })
  await putAwareness(fx, {
    id: A_FREQUENT,
    characterId: JORIN,
    happeningId: TOLL,
    learnedAtEntryId: fx.entries[1]!.id,
    decayResistance: null,
    retrievalCount: COUNTS.frequent,
    source: 'paid it twice',
  })
  await putAwareness(fx, {
    id: A_IDLE,
    characterId: MARA,
    happeningId: TOLL,
    learnedAtEntryId: fx.entries[1]!.id,
    decayResistance: 0.2,
  })
  await putAwareness(fx, {
    id: A_COMMON,
    characterId: ARIA,
    happeningId: RUMOUR,
    learnedAtEntryId: fx.entries[4]!.id,
    decayResistance: 0.9,
    retrievalCount: COUNTS.common,
  })
}

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

/** As the agent phase leaves the ids before any task: the chapter's turns, t1…t4. */
export function chapterIds(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(chapterOf(fx))
  return ids
}

export function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds = chapterIds(fx),
  abortSignal: AbortSignal = new AbortController().signal,
): TaskPromptContext {
  const actionId = 'act_awareness_start'
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, rangeOf(fx))
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: endOf(fx),
    task: 'awareness',
    part: 0,
    ids,
    readFields: {},
    survivorOf: () => undefined,
    landedCalls: () => 0,
    clusterOf: () => undefined,
    phase: {
      actionId,
      abortSignal,
      intermediates,
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    taskEntryIds: chapterOf(fx),
    config: START_CONFIG,
  }
}

/** A close over the chapter as one part; its chapter row is putChapter's. */
export function closePhaseFor(
  fx: CloseFixture,
  abortSignal: AbortSignal = new AbortController().signal,
): PhaseContext {
  return closePhaseContext(fx, { actionId: 'act_awareness_close', range: rangeOf(fx), abortSignal })
}
