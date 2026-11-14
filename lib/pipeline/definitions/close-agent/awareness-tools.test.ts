import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { USER_EDITED_SINCE_PROSE, type PipelineAction } from '@/lib/actions/types'
import {
  branches,
  chapters,
  deltas,
  emptyEntityState,
  ensureVecTablesSql,
  entities,
  happeningAwareness,
  happenings,
  packFloat32,
  sourceHash,
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  upsertVecOps,
  type HappeningAwareness,
  type ProbeCapturePayload,
} from '@/lib/db'
import { buildCapturePayload } from '@/lib/probe'
import { RANKER_DEFAULTS, runRetrieval } from '@/lib/retrieval'

import { setPinTool } from './awareness-tools'
import { assertReplaySafe } from './tool'
import { CLOSE_REASON } from './verdict'
import {
  runDispatchCalls,
  type DispatchRun,
  type DispatchTurns,
  type ScriptedCall,
  type ShownRow,
} from '../__tests__/close-dispatch'
import { openCloseFixture, queryAllOn, type CloseFixture } from '../__tests__/close-fixture'

// Real `prefix_<uuid>` ids: CloseIds hands handles for those only.
const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ARIA = `char_${uuid(1)}`
const JORIN = `char_${uuid(2)}`
const KAI = `char_${uuid(3)}`
const LENA = `char_${uuid(4)}`
const FIGHT = `hap_${uuid(11)}`
const TOLL = `hap_${uuid(12)}`
const CROSSING = `hap_${uuid(13)}`
// aw1…aw9, in the order SHOWN lists them.
const PINNED = `haw_${uuid(21)}`
const FREQUENT = `haw_${uuid(22)}`
const USER_PINNED = `haw_${uuid(23)}`
const LATER_PINNED = `haw_${uuid(24)}`
const LATER_SOURCED = `haw_${uuid(25)}`
// Shown, never seeded: a row gone before the call.
const GONE = `haw_${uuid(26)}`
// Seeded frequent rows: not learned in the chapter.
const LATER_FREQUENT = `haw_${uuid(27)}`
const UNPINNED_FREQUENT = `haw_${uuid(28)}`
const USER_FREQUENT = `haw_${uuid(29)}`

const SHOWN: readonly ShownRow[] = [
  PINNED,
  FREQUENT,
  USER_PINNED,
  LATER_PINNED,
  LATER_SOURCED,
  GONE,
  LATER_FREQUENT,
  UNPINNED_FREQUENT,
  USER_FREQUENT,
].map((id): ShownRow => ({ table: 'happening_awareness', id, name: '' }))

/** The chapter: the second turn to the third reply, t1…t4 by position; E is that reply. */
const chapterOf = (fx: CloseFixture): string[] => fx.entries.slice(3, 7).map(({ id }) => id)
const endOf = (fx: CloseFixture): string => fx.entries[6]!.id
/** The first reply, before the chapter. */
const earlierReplyOf = (fx: CloseFixture): string => fx.entries[2]!.id
/** The fifth reply: past E, under the fixture's act_close_turn_5. */
const laterReplyOf = (fx: CloseFixture): string => fx.replyIds[4]!

// As the Awareness start leaves the ids: the chapter's turns, then a frequent row's earlier one, t5.
const awarenessTurns = (fx: CloseFixture): DispatchTurns => ({
  endEntryId: endOf(fx),
  taskEntryIds: chapterOf(fx),
  part: 0,
  chapterEntryIds: [...chapterOf(fx), earlierReplyOf(fx)],
})

// Written with no delta, as an import leaves a row: precedence reads only the edits after it.
async function putCharacter(fx: CloseFixture, id: string, name: string): Promise<void> {
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

async function putHappening(
  fx: CloseFixture,
  row: { id: string; title: string; description?: string; occurredAtEntryId: string },
): Promise<void> {
  await fx.ctx.db.insert(happenings).values({
    id: row.id,
    branchId: fx.branchId,
    title: row.title,
    description: row.description ?? null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: row.occurredAtEntryId,
    commonKnowledge: 0,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
  })
}

type AwarenessSeed = Pick<
  HappeningAwareness,
  'id' | 'characterId' | 'happeningId' | 'learnedAtEntryId' | 'decayResistance'
> & { retrievalCount?: number; source?: string }

async function putAwareness(fx: CloseFixture, row: AwarenessSeed): Promise<void> {
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

async function apply(
  fx: CloseFixture,
  action: PipelineAction,
  actionId: string,
  entryId: string | null,
): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId, branchId: fx.branchId, entryId },
    fx.ctx,
  )
  if (result.status !== 'ok')
    throw new Error(`${action.kind} under ${actionId} refused: ${result.reason}`)
}

// user: after every turn's prose, unanchored. later-turn: the fifth turn's writer, past E.
async function editAwareness(
  fx: CloseFixture,
  who: 'user' | 'later-turn',
  pair: { characterId: string; happeningId: string },
  fields: { decayResistance?: number; source?: string },
): Promise<void> {
  const user = who === 'user'
  await apply(
    fx,
    {
      kind: 'upsertHappeningAwareness',
      source: user ? 'user_edit' : 'per_turn_classifier',
      payload: { branchId: fx.branchId, ...pair, ...fields, proseEntryId: null },
    },
    user ? 'act_user_edit' : 'act_close_turn_5',
    user ? null : laterReplyOf(fx),
  )
}

async function storedPin(fx: CloseFixture, id: string): Promise<number | null> {
  const [row] = await fx.ctx.db
    .select({ pin: happeningAwareness.decayResistance })
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, fx.branchId), eq(happeningAwareness.id, id)))
  if (row === undefined) throw new Error(`no awareness row ${id}`)
  return row.pin
}

function runDeltas(fx: CloseFixture, actionId: string) {
  return fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

const WHY = 'The chapter turns on it.'

const pin = (
  id: string,
  value: number,
  turns: readonly string[] = ['t2'],
  why = WHY,
): ScriptedCall => ({ toolName: 'set_pin', input: { id, value, turns: [...turns], why } })

// The Awareness start hands each listed row's pin as the model reads it, no pin as 0; a row gone
// has none.
async function startPinned(fx: CloseFixture, rows: readonly ShownRow[]): Promise<ShownRow[]> {
  const pins = new Map(
    (
      await fx.ctx.db
        .select({ id: happeningAwareness.id, pin: happeningAwareness.decayResistance })
        .from(happeningAwareness)
        .where(eq(happeningAwareness.branchId, fx.branchId))
    ).map(({ id, pin }) => [id, pin]),
  )
  return rows.map((row) => (pins.has(row.id) ? { ...row, startPin: pins.get(row.id) ?? 0 } : row))
}

async function pinCalls(fx: CloseFixture, calls: readonly ScriptedCall[]): Promise<DispatchRun> {
  return runDispatchCalls(fx, {
    task: 'awareness',
    tools: { set_pin: setPinTool },
    shown: await startPinned(fx, SHOWN),
    calls,
    turns: awarenessTurns(fx),
  })
}

describe('set_pin: the tool', () => {
  it('replays as sent, and takes an awareness row by its aw id', () => {
    assertReplaySafe(setPinTool.schema, [
      { id: 'aw1', value: 0.9, turns: ['t2'], why: 'It carries the chapter.' },
      { id: 'aw2', value: 0, turns: ['t1', 't3'], why: 'Incidental after all.' },
    ])
    expect(setPinTool.name).toBe('set_pin')
    expect(setPinTool.ids).toEqual({ id: { shape: 'single', prefixes: ['haw_'] } })
  })

  it('takes a pin from 0 to 1 and nothing outside it', () => {
    const takes = (value: number): boolean =>
      setPinTool.schema.safeParse({ id: 'aw1', value, turns: ['t2'], why: WHY }).success
    expect([takes(0), takes(0.45), takes(1)]).toEqual([true, true, true])
    expect([takes(-0.01), takes(1.01)]).toEqual([false, false])
  })
})

describe('set_pin', () => {
  let f: CloseFixture

  // aw1 Aria on the fight, learned at t2; aw2 Jorin on the fight, learned before the chapter (a
  // frequent row); aw3 Aria on the toll, the user's pin since; aw4 Jorin on the toll, a later
  // turn's pin; aw5 Aria on the crossing, whose source and count a later turn wrote; aw6 gone; aw7
  // Jorin on the crossing, a frequent row whose pin a later turn raised; aw8 Kai on the fight, a
  // frequent row with no pin; aw9 Kai on the toll, a frequent row the user re-pinned.
  beforeEach(async () => {
    f = await openCloseFixture()
    await putCharacter(f, ARIA, 'Aria')
    await putCharacter(f, JORIN, 'Jorin')
    await putCharacter(f, KAI, 'Kai')
    await putHappening(f, {
      id: FIGHT,
      title: 'A fight at the ferry',
      occurredAtEntryId: earlierReplyOf(f),
    })
    await putHappening(f, { id: TOLL, title: 'The new toll', occurredAtEntryId: f.entries[4]!.id })
    await putHappening(f, {
      id: CROSSING,
      title: 'The night crossing',
      occurredAtEntryId: f.entries[4]!.id,
    })
    await putAwareness(f, {
      id: PINNED,
      characterId: ARIA,
      happeningId: FIGHT,
      learnedAtEntryId: f.entries[4]!.id,
      decayResistance: 0.6,
      source: 'saw it',
    })
    await putAwareness(f, {
      id: FREQUENT,
      characterId: JORIN,
      happeningId: FIGHT,
      learnedAtEntryId: earlierReplyOf(f),
      decayResistance: 0.5,
      retrievalCount: 4,
      source: 'fought in it',
    })
    await putAwareness(f, {
      id: USER_PINNED,
      characterId: ARIA,
      happeningId: TOLL,
      learnedAtEntryId: f.entries[5]!.id,
      decayResistance: 0.4,
    })
    await editAwareness(
      f,
      'user',
      { characterId: ARIA, happeningId: TOLL },
      { decayResistance: 0.95 },
    )
    await putAwareness(f, {
      id: LATER_PINNED,
      characterId: JORIN,
      happeningId: TOLL,
      learnedAtEntryId: f.entries[5]!.id,
      decayResistance: 0.4,
    })
    await editAwareness(
      f,
      'later-turn',
      { characterId: JORIN, happeningId: TOLL },
      { decayResistance: 0.1 },
    )
    await putAwareness(f, {
      id: LATER_SOURCED,
      characterId: ARIA,
      happeningId: CROSSING,
      learnedAtEntryId: f.entries[4]!.id,
      decayResistance: 0.3,
    })
    await editAwareness(
      f,
      'later-turn',
      { characterId: ARIA, happeningId: CROSSING },
      { source: 'heard it at the toll house' },
    )
    await putAwareness(f, {
      id: LATER_FREQUENT,
      characterId: JORIN,
      happeningId: CROSSING,
      learnedAtEntryId: earlierReplyOf(f),
      decayResistance: 0.5,
    })
    await editAwareness(
      f,
      'later-turn',
      { characterId: JORIN, happeningId: CROSSING },
      { decayResistance: 0.9 },
    )
    await putAwareness(f, {
      id: UNPINNED_FREQUENT,
      characterId: KAI,
      happeningId: FIGHT,
      learnedAtEntryId: null,
      decayResistance: null,
    })
    await putAwareness(f, {
      id: USER_FREQUENT,
      characterId: KAI,
      happeningId: TOLL,
      learnedAtEntryId: earlierReplyOf(f),
      decayResistance: 0.5,
    })
    await editAwareness(
      f,
      'user',
      { characterId: KAI, happeningId: TOLL },
      { decayResistance: 0.95 },
    )
    await apply(
      f,
      {
        kind: 'bumpAwarenessRetrieval',
        source: 'per_turn_classifier',
        payload: { branchId: f.branchId, id: LATER_SOURCED, priorCount: 0 },
      },
      'act_close_turn_5',
      laterReplyOf(f),
    )
  })

  it('lands a lower pin on a row learned in this chapter as one upsertHappeningAwareness on E', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw1', 0.2, ['t4'])])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls).toEqual([
      {
        task: 'awareness',
        part: 0,
        tool: 'set_pin',
        rows: [{ table: 'happening_awareness', id: PINNED, name: 'Aria on A fight at the ferry' }],
        why: WHY,
        turns: [f.entries[6]!.id],
        result: 'ok',
        values: { decayResistance: '0.2' },
      },
    ])
    const written = await runDeltas(f, result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      targetTable: 'happening_awareness',
      targetId: PINNED,
      op: 'update',
      source: 'chapter_close',
      entryId: endOf(f),
      undoPayload: { decayResistance: 0.6 },
    })
    expect(await storedPin(f, PINNED)).toBe(0.2)
  })

  // A chapter_close upsert may move learned_at and the count, and the action drops unknown keys, so
  // the payload is read off the emitted group, not the row.
  it('sends a pin and its prose turn alone: no anchor, count or source', async () => {
    const { events } = await pinCalls(f, [pin('aw1', 0.2)])

    const groups = events.filter((event) => event.type === 'delta_group_emitted')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.actions).toEqual([
      {
        kind: 'upsertHappeningAwareness',
        source: 'chapter_close',
        payload: {
          branchId: f.branchId,
          characterId: ARIA,
          happeningId: FIGHT,
          decayResistance: 0.2,
          proseEntryId: f.entries[4]!.id,
        },
      },
    ])
  })

  it('shows an awareness row under an aw handle, which the tool resolves', async () => {
    const { ids } = await pinCalls(f, [])

    expect(SHOWN.map(({ id }) => ids.handleOf(id))).toEqual([
      'aw1',
      'aw2',
      'aw3',
      'aw4',
      'aw5',
      'aw6',
      'aw7',
      'aw8',
      'aw9',
    ])
  })

  // Nothing else showed Aria: a later why naming her by the handle the pin gave stores her name.
  it("shows the row's character with its name", async () => {
    const { calls } = await pinCalls(f, [
      pin('aw1', 0.2),
      pin('aw1', 0.2, ['t2'], 'c1 keeps the fight in mind.'),
    ])

    expect(calls[1]).toMatchObject({ result: 'ok', why: 'Aria keeps the fight in mind.' })
  })

  it('keeps the name of a character already shown nameless current', async () => {
    const { calls } = await runDispatchCalls(f, {
      task: 'awareness',
      tools: { set_pin: setPinTool },
      shown: await startPinned(f, [{ table: 'entities', id: ARIA, name: '' }, ...SHOWN]),
      calls: [pin('aw1', 0.2), pin('aw1', 0.2, ['t2'], 'c1 keeps the fight in mind.')],
      turns: awarenessTurns(f),
    })

    expect(calls[1]).toMatchObject({ result: 'ok', why: 'Aria keeps the fight in mind.' })
  })

  it('answers ok writing nothing for the pin the row already holds', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw1', 0.6)])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('answers ok, not skipped, for the pin a later turn wrote and the call restates', async () => {
    const { result, answers } = await pinCalls(f, [pin('aw4', 0.1)])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a lower pin on a row listed only for coming up often, and lands a higher one', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw2', 0.2), pin('aw2', 0.7)])

    expect(answers[0]).toEqual({
      result: 'rejected',
      reason: 'frequent-pin-lowered',
      note: 'This row is listed because it keeps coming up, not for this chapter, so its pin only rises: send 0.5 or more, or leave it.',
    })
    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: 'frequent-pin-lowered',
      values: { decayResistance: '0.2' },
    })
    expect(calls[0]).not.toHaveProperty('survivor')
    expect(answers[1]).toEqual({ result: 'ok' })
    const written = await runDeltas(f, result.actionId)
    expect(written.map(({ targetId, undoPayload }) => [targetId, undoPayload])).toEqual([
      [FREQUENT, { decayResistance: 0.5 }],
    ])
    expect(await storedPin(f, FREQUENT)).toBe(0.7)
  })

  it('lands a pin of 0 on a frequent row with no pin, which reads 0', async () => {
    const { answers } = await pinCalls(f, [pin('aw8', 0), pin('aw8', 0.2)])

    expect(answers).toEqual([{ result: 'ok' }, { result: 'ok' }])
    expect(await storedPin(f, UNPINNED_FREQUENT)).toBe(0.2)
  })

  it('answers skipped, not frequent-pin-lowered, for a lower pin over a later turn on a frequent row', async () => {
    const { result, answers } = await pinCalls(f, [pin('aw7', 0.3)])

    expect(answers[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(await storedPin(f, LATER_FREQUENT)).toBe(0.9)
  })

  it('refuses a cited turn outside the chapter on a frequent row, writing nothing', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw2', 0.8, ['t5'])])

    expect(answers).toEqual([
      {
        result: 'rejected',
        reason: 't5 is not one of the turns this task was shown: cite only those turns',
      },
    ])
    expect(calls[0]).toMatchObject({ result: 'rejected', turns: [] })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(await storedPin(f, FREQUENT)).toBe(0.5)
  })

  it('skips a pin the user set after the cited turn', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw3', 0.7)])

    expect(answers[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      values: { decayResistance: '0.7' },
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(await storedPin(f, USER_PINNED)).toBe(0.95)
  })

  it('skips, not refuses, a lower pin over the user on a frequent row', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw9', 0.3)])

    expect(answers[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(await storedPin(f, USER_FREQUENT)).toBe(0.95)
  })

  it('skips a pin a later turn wrote, writing nothing', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw4', 0.7)])

    expect(answers[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: CLOSE_REASON.laterTurn,
      values: { decayResistance: '0.7' },
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect(await storedPin(f, LATER_PINNED)).toBe(0.1)
  })

  // C12: a later turn's write to another field does not protect the pin.
  it('lands over a later turn that wrote another field and bumped the count', async () => {
    const { result, answers } = await pinCalls(f, [pin('aw5', 0.5)])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(await runDeltas(f, result.actionId)).toHaveLength(1)
    expect(await storedPin(f, LATER_SOURCED)).toBe(0.5)
  })

  // The user's pin is theirs from the moment they set it, not only after the cited turn's prose.
  describe('a pin the user set before the cited turn', () => {
    const USER_EARLY = `haw_${uuid(41)}`
    const NEVER_EDITED = `haw_${uuid(42)}`
    const CITED = `entry_${uuid(900)}`

    // The user pins Lena on the fight, then the chapter's one turn is written, so its prose is
    // the later of the two.
    beforeEach(async () => {
      await putCharacter(f, LENA, 'Lena')
      for (const [id, happeningId] of [
        [USER_EARLY, FIGHT],
        [NEVER_EDITED, TOLL],
      ] as const)
        await putAwareness(f, {
          id,
          characterId: LENA,
          happeningId,
          learnedAtEntryId: null,
          decayResistance: 0.4,
        })
      await editAwareness(
        f,
        'user',
        { characterId: LENA, happeningId: FIGHT },
        { decayResistance: 0.6 },
      )
      await apply(
        f,
        {
          kind: 'createStoryEntry',
          source: 'ai_classifier',
          payload: {
            entry: {
              id: CITED,
              branchId: f.branchId,
              position: 100,
              kind: 'ai_reply',
              content: 'Lena crosses.',
              chapterId: null,
              createdAt: 1,
            },
          },
        },
        'act_cited_turn',
        CITED,
      )
      await f.ctx.db
        .update(happeningAwareness)
        .set({ learnedAtEntryId: CITED })
        .where(inArray(happeningAwareness.id, [USER_EARLY, NEVER_EDITED]))
    })

    const earlyCalls = async (calls: readonly ScriptedCall[]): Promise<DispatchRun> =>
      runDispatchCalls(f, {
        task: 'awareness',
        tools: { set_pin: setPinTool },
        shown: await startPinned(
          f,
          [USER_EARLY, NEVER_EDITED].map((id) => ({
            table: 'happening_awareness' as const,
            id,
            name: '',
          })),
        ),
        calls,
        turns: { endEntryId: CITED, taskEntryIds: [CITED], part: 0 },
      })

    it('skips both a lower pin and a raise of it', async () => {
      const { result, answers } = await earlyCalls([
        pin('aw1', 0.2, ['t1']),
        pin('aw1', 0.7, ['t1']),
      ])

      expect(answers).toEqual([
        {
          result: 'skipped',
          reason: USER_EDITED_SINCE_PROSE,
          note: 'The user edited this after the cited turns; their value stands. Do not write it again.',
        },
        {
          result: 'skipped',
          reason: USER_EDITED_SINCE_PROSE,
          note: 'The user edited this after the cited turns; their value stands. Do not write it again.',
        },
      ])
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect(await storedPin(f, USER_EARLY)).toBe(0.6)
    })

    it('lands a pin on a row the user never wrote', async () => {
      const { answers } = await earlyCalls([pin('aw2', 0.5, ['t1'])])

      expect(answers).toEqual([{ result: 'ok' }])
      expect(await storedPin(f, NEVER_EDITED)).toBe(0.5)
    })
  })

  // The chapter runs from t1 to E, t4: a row learned at either end is the chapter's.
  describe("a row learned at the chapter's first turn or at E", () => {
    const AT_FIRST = `haw_${uuid(46)}`
    const AT_END = `haw_${uuid(47)}`

    beforeEach(async () => {
      await putCharacter(f, LENA, 'Lena')
      for (const [id, happeningId, learnedAtEntryId] of [
        [AT_FIRST, FIGHT, f.entries[3]!.id],
        [AT_END, TOLL, endOf(f)],
      ] as const)
        await putAwareness(f, {
          id,
          characterId: LENA,
          happeningId,
          learnedAtEntryId,
          decayResistance: 0.6,
        })
    })

    it('lowers its pin, not refusing it as a frequent row', async () => {
      const { answers } = await runDispatchCalls(f, {
        task: 'awareness',
        tools: { set_pin: setPinTool },
        shown: await startPinned(
          f,
          [AT_FIRST, AT_END].map((id) => ({ table: 'happening_awareness' as const, id, name: '' })),
        ),
        calls: [pin('aw1', 0.1), pin('aw2', 0.1)],
        turns: awarenessTurns(f),
      })

      expect(answers).toEqual([{ result: 'ok' }, { result: 'ok' }])
      expect(await storedPin(f, AT_FIRST)).toBe(0.1)
      expect(await storedPin(f, AT_END)).toBe(0.1)
    })
  })

  describe('the raise step', () => {
    async function setStored(id: string, pin: number): Promise<void> {
      await f.ctx.db
        .update(happeningAwareness)
        .set({ decayResistance: pin })
        .where(and(eq(happeningAwareness.branchId, f.branchId), eq(happeningAwareness.id, id)))
    }

    const note = (ceiling: number): string =>
      `This close can raise it to ${ceiling} at most: send ${ceiling} or less, or leave it.`

    it.each([
      ['a chapter row', 'aw1', PINNED, 0.6, 0.9, 0.8],
      ['a frequent row', 'aw2', FREQUENT, 0.5, 0.9, 0.7],
      ['a frequent row with no pin', 'aw8', UNPINNED_FREQUENT, null, 0.5, 0.2],
    ] as const)(
      'refuses a raise past the step on %s, naming the highest value',
      async (_, handle, id, stored, value, ceiling) => {
        const { result, answers, calls } = await pinCalls(f, [pin(handle, value)])

        expect(answers).toEqual([
          { result: 'rejected', reason: 'pin-raise-too-large', note: note(ceiling) },
        ])
        expect(calls[0]).toMatchObject({
          result: 'rejected',
          reason: 'pin-raise-too-large',
          values: { decayResistance: String(value) },
        })
        expect(await runDeltas(f, result.actionId)).toEqual([])
        expect(await storedPin(f, id)).toBe(stored)
      },
    )

    it('refuses a raise a hundredth past the step', async () => {
      await setStored(PINNED, 0.4)

      const { answers } = await pinCalls(f, [pin('aw1', 0.61)])

      expect(answers).toEqual([
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(0.6) },
      ])
    })

    // Each passes 0.2 by under half a hundredth: the step is measured exactly.
    it.each([
      [0.4, 0.6049, 0.6],
      [0.675, 0.884, 0.875],
    ])('refuses a raise from %s to %s, past 0.2, naming %s', async (stored, value, ceiling) => {
      await setStored(PINNED, stored)

      const { answers } = await pinCalls(f, [pin('aw1', value)])

      expect(answers).toEqual([
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(ceiling) },
      ])
    })

    // A note's ceiling comes back as it reads, so it names no more than the step: 0.32345678916 is
    // cut, not rounded up.
    it.each([
      [0.565, '0.765'],
      [0.145, '0.345'],
      [0.12345678916, '0.3234567891'],
    ])('names a ceiling from %s that lands when sent: %s', async (stored, ceiling) => {
      await setStored(PINNED, stored)

      const { answers } = await pinCalls(f, [pin('aw1', 1), pin('aw1', Number(ceiling))])

      expect(answers).toEqual([
        {
          result: 'rejected',
          reason: 'pin-raise-too-large',
          note: `This close can raise it to ${ceiling} at most: send ${ceiling} or less, or leave it.`,
        },
        { result: 'ok' },
      ])
      expect(await storedPin(f, PINNED)).toBe(Number(ceiling))
    })

    // 0.3 + 0.2 lands on 0.5 exactly, so the slack's edge is a billionth past it.
    it('lands a raise inside the float slack past the step, and refuses one past the slack', async () => {
      await setStored(PINNED, 0.3)

      const { answers } = await pinCalls(f, [pin('aw1', 0.500000002), pin('aw1', 0.500000001)])

      expect(answers).toEqual([
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(0.5) },
        { result: 'ok' },
      ])
    })

    // In floating point 0.9 - 0.7 and 0.55 - 0.35 come to a hair over 0.2, and 0.565 + 0.2 to a
    // hair under 0.765; 0.565 and 0.145 sit on a half hundredth.
    it.each([
      [0.4, 0.6],
      [0.1, 0.3],
      [0.7, 0.9],
      [0.35, 0.55],
      [0.57, 0.77],
      [0.9, 1],
      [0.565, 0.765],
      [0.145, 0.345],
    ])('lands a raise from %s to %s, a step of at most 0.2', async (stored, value) => {
      await setStored(PINNED, stored)
      await setStored(FREQUENT, stored)

      const { answers } = await pinCalls(f, [pin('aw1', value), pin('aw2', value)])

      expect(answers).toEqual([{ result: 'ok' }, { result: 'ok' }])
      expect(await storedPin(f, PINNED)).toBe(value)
      expect(await storedPin(f, FREQUENT)).toBe(value)
    })

    // The step and the floor hold from the pin the start showed, not the one a call left.
    it('refuses a second raise past the start pin plus 0.2, though each step is within 0.2', async () => {
      const { answers } = await pinCalls(f, [pin('aw2', 0.7), pin('aw2', 0.9), pin('aw2', 1)])

      expect(answers).toEqual([
        { result: 'ok' },
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(0.7) },
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(0.7) },
      ])
      expect(await storedPin(f, FREQUENT)).toBe(0.7)
    })

    it('restores a chapter row lowered by mistake, and raises it to the start pin plus 0.2', async () => {
      const { answers } = await pinCalls(f, [
        pin('aw1', 0.2),
        pin('aw1', 0.6),
        pin('aw1', 0.8),
        pin('aw1', 0.81),
      ])

      expect(answers).toEqual([
        { result: 'ok' },
        { result: 'ok' },
        { result: 'ok' },
        { result: 'rejected', reason: 'pin-raise-too-large', note: note(0.8) },
      ])
      expect(await storedPin(f, PINNED)).toBe(0.8)
    })

    it('refuses a frequent row lowered below its start pin after a raise, and lets it back to it', async () => {
      const { answers } = await pinCalls(f, [pin('aw2', 0.7), pin('aw2', 0.4), pin('aw2', 0.5)])

      expect(answers).toEqual([
        { result: 'ok' },
        {
          result: 'rejected',
          reason: 'frequent-pin-lowered',
          note: 'This row is listed because it keeps coming up, not for this chapter, so its pin only rises: send 0.5 or more, or leave it.',
        },
        { result: 'ok' },
      ])
      expect(await storedPin(f, FREQUENT)).toBe(0.5)
    })

    it('refuses a row the start showed no pin for, rather than reading its live pin', async () => {
      const { result, answers, calls } = await runDispatchCalls(f, {
        task: 'awareness',
        tools: { set_pin: setPinTool },
        shown: SHOWN,
        calls: [pin('aw1', 0.7)],
        turns: awarenessTurns(f),
      })

      expect(answers).toEqual([
        {
          result: 'rejected',
          reason: 'no-start-pin',
          note: 'The task showed no pin for this row, so it cannot be pinned: leave it.',
        },
      ])
      expect(calls[0]).toMatchObject({ result: 'rejected', reason: 'no-start-pin' })
      expect(await runDeltas(f, result.actionId)).toEqual([])
    })

    it('reads no pin as 0, so a first pin of 0.2 lands', async () => {
      const { answers } = await pinCalls(f, [pin('aw8', 0.2)])

      expect(answers).toEqual([{ result: 'ok' }])
      expect(await storedPin(f, UNPINNED_FREQUENT)).toBe(0.2)
    })

    it('answers skipped, not the step refusal, for a pin a later turn wrote', async () => {
      const { answers } = await pinCalls(f, [pin('aw4', 0.9)])

      expect(answers[0]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
    })

    it('answers skipped, not the step refusal, for a pin the user wrote', async () => {
      await editAwareness(
        f,
        'user',
        { characterId: ARIA, happeningId: CROSSING },
        { decayResistance: 0.1 },
      )

      const { answers } = await pinCalls(f, [pin('aw5', 0.9)])

      expect(answers[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    })
  })

  // A sibling branch of the story holds aw1's row, Aria and the fight under the same ids, ahead of
  // this branch's in a table scan, with a pin the call restates and other names.
  it('reads the row and its names on this branch when a sibling branch holds rows under the same ids', async () => {
    const OTHER_BRANCH = 'br_other'
    const sibling = f.ctx.db
    await sibling
      .insert(branches)
      .values({ id: OTHER_BRANCH, storyId: f.storyId, name: 'other', createdAt: 1 })
    await sibling.insert(entities).values({
      id: ARIA,
      branchId: OTHER_BRANCH,
      kind: 'character',
      name: 'Sibling Aria',
      status: 'active',
      injectionMode: 'auto',
      state: emptyEntityState('character'),
      keywords: [],
      createdAt: 1,
      updatedAt: 1,
    })
    await sibling.insert(happenings).values({
      id: FIGHT,
      branchId: OTHER_BRANCH,
      title: 'Sibling fight',
      occurredAtEntryId: earlierReplyOf(f),
      commonKnowledge: 0,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await sibling.insert(happeningAwareness).values({
      id: PINNED,
      branchId: OTHER_BRANCH,
      happeningId: FIGHT,
      characterId: ARIA,
      learnedAtEntryId: earlierReplyOf(f),
      decayResistance: 0.2,
      retrievalCount: 0,
    })
    for (const table of ['entities', 'happenings', 'happening_awareness'])
      await sibling.run(
        sql`UPDATE ${sql.identifier(table)} SET rowid = -1 WHERE branch_id = ${OTHER_BRANCH}`,
      )

    const { result, answers, calls } = await pinCalls(f, [pin('aw1', 0.2)])

    expect(answers).toEqual([{ result: 'ok' }])
    expect(calls[0]).toMatchObject({
      rows: [{ table: 'happening_awareness', id: PINNED, name: 'Aria on A fight at the ferry' }],
    })
    expect(await runDeltas(f, result.actionId)).toHaveLength(1)
    expect(await storedPin(f, PINNED)).toBe(0.2)
  })

  it('refuses a gone row as row-gone', async () => {
    const { result, answers, calls } = await pinCalls(f, [pin('aw6', 0.5)])

    expect(answers).toEqual([
      {
        result: 'rejected',
        reason: 'row-gone',
        note: 'The row is gone; do not write to it again.',
      },
    ])
    expect(calls[0]).toMatchObject({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      values: { decayResistance: '0.5' },
    })
    expect(calls[0]).not.toHaveProperty('survivor')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })
})

// 59 closed chapters, a row learned in chapter 3 at 0.3, read at chapter 60, the open one. The pin
// reaches the score only through the decay exponent.
describe('a pin moves a score', () => {
  const DIM = 4
  const MODEL = 'pin-score-embed'
  const AXIS = Float32Array.from([1, 0, 0, 0])
  const HERO = `char_${uuid(31)}`
  const OATH = `hap_${uuid(32)}`
  const OATH_KNOWN = `haw_${uuid(33)}`
  const OATH_TITLE = 'The oath at the ford'
  const OATH_DESCRIPTION = 'Aria swore to carry the letter to Low Ashby.'
  let fx: CloseFixture

  const chapterId = (k: number): string => `chap_${uuid(1000 + k)}`

  // Chapter k holds entries[k - 1] alone, so chapter 3 is the first reply; the last two entries
  // stay open.
  async function closeFiftyNineChapters(): Promise<void> {
    for (let k = 1; k <= 59; k++) {
      const entryId = fx.entries[k - 1]!.id
      await fx.ctx.db.insert(chapters).values({
        id: chapterId(k),
        branchId: fx.branchId,
        sequenceNumber: k,
        title: `Chapter ${k}`,
        summary: 'The road goes on.',
        theme: 'the road',
        keywords: [],
        startEntryId: entryId,
        endEntryId: entryId,
        tokenCount: 1,
        closedAt: 1,
        embeddingStale: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      await fx.ctx.db
        .update(storyEntries)
        .set({ chapterId: chapterId(k) })
        .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId)))
    }
  }

  beforeEach(async () => {
    fx = await openCloseFixture({ turns: 30 })
    await closeFiftyNineChapters()
    await putCharacter(fx, HERO, 'Aria')
    await putHappening(fx, {
      id: OATH,
      title: OATH_TITLE,
      description: OATH_DESCRIPTION,
      occurredAtEntryId: fx.entries[2]!.id,
    })
    await putAwareness(fx, {
      id: OATH_KNOWN,
      characterId: HERO,
      happeningId: OATH,
      learnedAtEntryId: fx.entries[2]!.id,
      decayResistance: 0.3,
      retrievalCount: 2,
      source: 'swore it herself',
    })
    for (const ddl of ensureVecTablesSql(DIM)) await fx.ctx.db.run(sql.raw(ddl))
    await fx.ctx.runInTransaction(
      upsertVecOps(
        {
          kind: 'happening',
          id: OATH,
          branchId: fx.branchId,
          modelId: MODEL,
          dim: DIM,
          sourceHash: sourceHash(OATH_TITLE),
          vector: packFloat32(AXIS),
        },
        { fields: [OATH_TITLE, OATH_DESCRIPTION] },
      ),
    )
  }, 30_000)

  // A real pass over the fixture's rows, Aria in the scene and every query on the oath's axis;
  // the probe's capture of the oath's row.
  async function capturedOath(): Promise<ProbeCapturePayload['pools']['happenings'][number]> {
    const outcome = await runRetrieval(
      {
        queryAll: queryAllOn(fx.ctx.db),
        embedTexts: async (texts) => ({ vectors: texts.map(() => AXIS), dim: DIM }),
        loadStaleRows: async () => [],
        revalidateRows: async (rows) => ({ staleRows: rows, freshOps: [] }),
        embedRows: async () => [],
        runInTransaction: fx.ctx.runInTransaction,
      },
      {
        branchId: fx.branchId,
        modelId: MODEL,
        dim: DIM,
        budgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
        query: { userAction: 'I ask Aria about the oath.', eraName: null, piggybackSummary: null },
        sceneCharacterIds: [HERO],
        sceneEntityIds: [],
        currentLocationId: null,
        storeEntities: [],
        recentProse: '',
        scanText: '',
        keywordRetrieval: STORY_SETTINGS_DEFAULTS.keywordRetrieval,
      },
    )
    if (!outcome.ok) throw new Error(`the pass failed: ${JSON.stringify(outcome)}`)
    const capture = buildCapturePayload({
      branchId: fx.branchId,
      targetEntryId: fx.entries[60]!.id,
      chapterId: null,
      capturedAt: 1,
      embeddingModelId: MODEL,
      mode: 'light',
      params: RANKER_DEFAULTS,
      settings: {
        retrievalBudgets: STORY_SETTINGS_DEFAULTS.retrievalBudgets,
        fullChapterInBuffer: false,
        partialChapterBuffer: 2,
        protectedBuffer: 1,
      },
      promptBufferTokens: 0,
      scanText: '',
      outcome,
    })
    const oath = capture.pools.happenings.find((row) => row.target_id === OATH)
    if (oath === undefined) throw new Error('the oath never reached the happenings pool')
    return oath
  }

  it("raises the next pass's captured recency_factor through the real action", async () => {
    const before = await capturedOath()
    expect(before).toMatchObject({ chapters_old: 57, pin_signal: 0.3 })
    expect(Math.abs(before.recency_factor - Math.exp(-0.07 * 57 * 0.7))).toBeLessThan(0.001)

    // Chapter 59's close: E is its one entry, and the oath's row is a frequent one.
    const endEntryId = fx.entries[58]!.id
    const { answers } = await runDispatchCalls(fx, {
      task: 'awareness',
      tools: { set_pin: setPinTool },
      shown: await startPinned(fx, [{ table: 'happening_awareness', id: OATH_KNOWN, name: '' }]),
      calls: [
        {
          toolName: 'set_pin',
          input: { id: 'aw1', value: 0.5, turns: ['t1'], why: 'The oath still binds her.' },
        },
      ],
      turns: { endEntryId, taskEntryIds: [endEntryId], part: 0 },
    })
    expect(answers).toEqual([{ result: 'ok' }])

    const after = await capturedOath()
    expect(after).toMatchObject({ chapters_old: 57, pin_signal: 0.5 })
    expect(Math.abs(after.recency_factor - Math.exp(-0.07 * 57 * 0.5))).toBeLessThan(0.001)
  }, 30_000)
})
