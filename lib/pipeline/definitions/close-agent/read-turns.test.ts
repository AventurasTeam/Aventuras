import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { branches, deltas, storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { entriesStore, resetAllStores } from '@/lib/stores'

import { CloseIds } from './ids'
import { readTurnsTool } from './read-turns'
import { assertReplaySafe, type ToolContext } from './tool'
import { runDispatchCalls } from '../__tests__/close-dispatch'
import {
  flagLead,
  openCloseFixture,
  putEntityRow,
  stampLead,
  type CloseFixture,
} from '../__tests__/close-fixture'

const WREN = 'char_00000000-0000-4000-8000-000000000001'
// The fixture's opening, first action, first reply and third reply (close-fixture.ts).
const OPENING = /^Rain had followed Wren from the coast for three days/
const FIRST_ACTION = 'I tie the mare outside the inn and shake the rain from my hood.'
const FIRST_REPLY = /^The inn is warm and loud with drovers\./
const THIRD_REPLY = /^The landing is a black line of planks over black water\./
const ARIA = 'char_00000000-0000-4000-8000-000000000002'
// Stamped on entries, never written as a row: a character since deleted.
const GONE = 'char_00000000-0000-4000-8000-0000000000ff'
const SECOND_ACTION = 'I ask the innkeeper whether the ferry still runs at night.'
const SECOND_REPLY = /^She shrugs\./
// Written out, never imported: the note is the answer's contract with the model.
const LEAD_MARK_NOTE =
  'A turn with a leadMark was written under a different lead from the turn before it in this answer (the first one in the answer, from the lead your task names). From that turn until the next one with a leadMark, "I" and "you" outside quoted speech are who its leadMark names, not the lead your task names: a character, by id and name; gone, a character no longer in the story, so credit nothing to that "I"; or none, no one. Before the first leadMark, they are the lead your task names, if it names one.'

const idsOf = (fx: CloseFixture, from: number, to?: number): string[] =>
  fx.entries.slice(from, to).map(({ id }) => id)

type TurnsAnswer = {
  note?: string
  turns: { id: string; kind: string; prose: string; leadMark?: unknown }[]
  unread?: string[]
  notRead?: { id: string; reason: string }[]
}

afterEach(() => {
  resetAllStores()
})

/** A chapter-wide task over the opening through `fx.entries[endAt]` (shown t1…); E is that entry. */
function chapterContext(fx: CloseFixture, endAt: number): ToolContext {
  const chapter = fx.entries.slice(0, endAt + 1).map(({ id }) => id)
  const ids = new CloseIds()
  ids.showTurns(chapter)
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: chapter.at(-1)!,
    task: 'awareness',
    part: 0,
    taskEntryIds: chapter,
    ids,
    readFields: {},
    survivorOf: () => undefined,
    clusterOf: () => undefined,
    landedCalls: () => 0,
  }
}

async function readTurns(ctx: ToolContext, turns: string[]): Promise<TurnsAnswer> {
  const answer = await readTurnsTool.read({ turns }, ctx)
  // Nothing read seeds a write: a turn is no row.
  expect(answer.rows).toEqual([])
  expect(answer.read).toEqual([])
  return answer.output as TurnsAnswer
}

describe('read_turns', () => {
  it('reads an entry older than the reader window, from the database', async () => {
    const fx = await openCloseFixture({ turns: 30 })
    // The store holds the last 50 of 61 entries: the newest, not the opening.
    expect(entriesStore.getById(fx.branchId, fx.entries.at(-1)!.id)).toBeDefined()
    expect(entriesStore.getById(fx.branchId, fx.entries[0]!.id)).toBeUndefined()

    expect(await readTurns(chapterContext(fx, fx.entries.length - 1), ['t1'])).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
    })
  })

  it('answers the turns in story order, whatever order they were asked in, each once', async () => {
    const fx = await openCloseFixture()

    expect(await readTurns(chapterContext(fx, 6), ['t3', 't1', 't2', 't3'])).toEqual({
      turns: [
        { id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) },
        { id: 't2', kind: 'user_action', prose: FIRST_ACTION },
        { id: 't3', kind: 'ai_reply', prose: expect.stringMatching(FIRST_REPLY) },
      ],
    })
  })

  it('gives a reply its prose without the state block stored after it', async () => {
    const fx = await openCloseFixture()
    await fx.ctx.db
      .update(storyEntries)
      .set({ content: 'The inn is warm.\n<state><summary>An inn</summary></state>' })
      .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, fx.entries[2]!.id)))

    expect(await readTurns(chapterContext(fx, 6), ['t3'])).toEqual({
      turns: [{ id: 't3', kind: 'ai_reply', prose: 'The inn is warm.' }],
    })
  })

  it('names a system row as not read, with no prose', async () => {
    const fx = await openCloseFixture()
    await fx.ctx.db.insert(storyEntries).values({
      id: 'entry_close_note',
      branchId: fx.branchId,
      position: 2,
      kind: 'system',
      content: 'The chapter was closed by hand.',
      chapterId: null,
      metadata: null,
      createdAt: 1,
    })
    const ctx = chapterContext(fx, 6)
    const note = ctx.ids.showTurn('entry_close_note')

    expect(note).toBe('t8')
    expect(await readTurns(ctx, [note, 't1'])).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
      notRead: [{ id: 't8', reason: 'a system note, not a turn of the story' }],
    })
  })

  it('names an entry of another branch as not read, with no prose', async () => {
    const fx = await openCloseFixture()
    await fx.ctx.db
      .insert(branches)
      .values({ id: 'br_other', storyId: fx.storyId, name: 'other', createdAt: 1 })
    await fx.ctx.db.insert(storyEntries).values({
      id: 'entry_other_branch',
      branchId: 'br_other',
      position: 1,
      kind: 'ai_reply',
      content: 'A reply no one on this branch wrote.',
      chapterId: null,
      metadata: null,
      createdAt: 1,
    })
    const ctx = chapterContext(fx, 6)
    const stray = ctx.ids.showTurn('entry_other_branch')

    expect(stray).toBe('t8')
    expect(await readTurns(ctx, [stray, 't1'])).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
      notRead: [{ id: 't8', reason: 'no such turn on this branch' }],
    })
  })

  it('names a turn past the end of the chapter as not read, and reads the end itself', async () => {
    const fx = await openCloseFixture()
    const ctx = chapterContext(fx, 6)
    const later = ctx.ids.showTurn(fx.entries[9]!.id)

    expect(later).toBe('t8')
    expect(await readTurns(ctx, ['t8', 't7'])).toEqual({
      turns: [{ id: 't7', kind: 'ai_reply', prose: expect.stringMatching(THIRD_REPLY) }],
      notRead: [{ id: 't8', reason: 'past the end of this chapter' }],
    })
  })

  it('answers an unknown handle, a row handle and a full id with a reason and no prose', async () => {
    const fx = await openCloseFixture()
    const ctx = chapterContext(fx, 6)
    ctx.ids.show(WREN, 'Wren')
    const fullId = generateId('entry')

    const answer = await readTurns(ctx, ['t99', 'c1', fullId, 't1'])

    expect(answer).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
      notRead: [
        { id: 't99', reason: 'no turn was shown with this handle' },
        { id: 'c1', reason: 'not a turn: read_turns takes turn handles (t1, t2…)' },
        { id: 'a full id', reason: 'a full id: give the short handle you were shown (t1, t2…)' },
      ],
    })
    expect(JSON.stringify(answer)).not.toContain(fullId)
  })

  it('names each handle it could not read once, however often it was asked', async () => {
    const fx = await openCloseFixture()
    const asked = ['t99', generateId('entry'), 't1', 't99', generateId('entry'), 't1']

    expect(await readTurns(chapterContext(fx, 6), asked)).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
      notRead: [
        { id: 't99', reason: 'no turn was shown with this handle' },
        { id: 'a full id', reason: 'a full id: give the short handle you were shown (t1, t2…)' },
      ],
    })
  })

  it('reads ten turns and names the eleventh as unread', async () => {
    const fx = await openCloseFixture()
    const asked = ['t11', 't10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2', 't1']

    const answer = await readTurns(chapterContext(fx, 12), asked)

    expect(answer.turns.map(({ id }) => id)).toEqual([
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
      't9',
      't10',
    ])
    expect(answer.unread).toEqual(['t11'])
    expect(answer.notRead).toBeUndefined()
  })

  it('reads a turn of an earlier chapter, ahead of the chapter turns', async () => {
    const fx = await openCloseFixture()
    const chapter = fx.entries.slice(7, 13).map(({ id }) => id)
    const ids = new CloseIds()
    ids.showTurns(chapter)
    const ctx: ToolContext = { ...chapterContext(fx, 12), ids, taskEntryIds: chapter }
    const earlier = ids.showTurn(fx.entries[2]!.id)

    expect(earlier).toBe('t7')
    expect(await readTurns(ctx, ['t1', earlier])).toEqual({
      turns: [
        { id: 't7', kind: 'ai_reply', prose: expect.stringMatching(FIRST_REPLY) },
        { id: 't1', kind: fx.entries[7]!.kind, prose: expect.any(String) },
      ],
    })
  })

  it('answers a bracketed handle as the plain handle', async () => {
    const fx = await openCloseFixture()

    expect(await readTurns(chapterContext(fx, 6), ['[t1]'])).toEqual({
      turns: [{ id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) }],
    })
  })

  it('throws when the chapter end is not on the branch', async () => {
    const fx = await openCloseFixture()
    const ctx = { ...chapterContext(fx, 6), endEntryId: 'entry_gone' }

    await expect(readTurnsTool.read({ turns: ['t1'] }, ctx)).rejects.toThrow(
      "read_turns: the chapter's end entry entry_gone is not on the branch",
    )
  })

  it('replays its arguments as written', () => {
    assertReplaySafe(readTurnsTool.schema, [{ turns: ['t1', 't2'] }, { turns: [] }])
  })

  it('answers through dispatch in handles, writes nothing and records a read', async () => {
    const fx = await openCloseFixture()
    const chapter = fx.entries.slice(0, 7).map(({ id }) => id)

    const { result, answers, calls } = await runDispatchCalls(fx, {
      task: 'awareness',
      tools: { read_turns: readTurnsTool },
      shown: [],
      calls: [{ toolName: 'read_turns', input: { turns: ['t2', 't1'] } }],
      turns: { endEntryId: chapter.at(-1)!, taskEntryIds: chapter, part: 0 },
    })

    expect(answers).toEqual([
      {
        turns: [
          { id: 't1', kind: 'opening', prose: expect.stringMatching(OPENING) },
          { id: 't2', kind: 'user_action', prose: FIRST_ACTION },
        ],
      },
    ])
    expect(JSON.stringify(answers)).not.toContain('entry_')
    expect(calls).toEqual([
      {
        task: 'awareness',
        part: 0,
        tool: 'read_turns',
        rows: [],
        why: '',
        turns: [],
        result: 'ok',
      },
    ])
    expect(
      await fx.ctx.db.select().from(deltas).where(eq(deltas.actionId, result.actionId)),
    ).toEqual([])
  })
})

// memory/chapter-close.md → Tools and writes: a turn "as the prompt shows it, lead marks included",
// walked over the answered turns from the lead the task names.
describe('read_turns → lead marks', () => {
  it("marks no answered turn and adds no note when every stamp is the lead's", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 7), WREN)

    const answer = await readTurns(chapterContext(fx, 6), ['t2', 't1'])

    expect(Object.keys(answer)).toEqual(['turns'])
    expect(answer.turns.map((turn) => Object.keys(turn))).toEqual([
      ['id', 'kind', 'prose'],
      ['id', 'kind', 'prose'],
    ])
  })

  it("marks the first answered turn of each lead's run with its handle and name, the note first", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 3), ARIA)
    await stampLead(fx, idsOf(fx, 3, 7), WREN)
    const ctx = chapterContext(fx, 6)

    const answer = await readTurns(ctx, ['t5', 't1', 't4', 't2'])

    expect(Object.keys(answer)).toEqual(['note', 'turns'])
    expect(answer.note).toBe(LEAD_MARK_NOTE)
    // t3 (Aria's) isn't answered: t4 is compared with t2, the answered turn before it.
    expect(answer.turns).toEqual([
      {
        id: 't1',
        kind: 'opening',
        prose: expect.stringMatching(OPENING),
        leadMark: { id: 'c1', name: 'Aria' },
      },
      { id: 't2', kind: 'user_action', prose: FIRST_ACTION },
      {
        id: 't4',
        kind: 'user_action',
        prose: SECOND_ACTION,
        leadMark: { id: 'c2', name: 'Wren' },
      },
      { id: 't5', kind: 'ai_reply', prose: expect.stringMatching(SECOND_REPLY) },
    ])
    expect(answer.turns.map((turn) => 'leadMark' in turn)).toEqual([true, false, true, false])
    // Shown with the name, so a handle copied into prose is stored as "Aria".
    expect(ctx.ids.idOf('c1')).toBe(ARIA)
    expect(ctx.ids.nameOf('c1')).toBe('Aria')
  })

  it('marks a run under a character the branch no longer holds as gone, and shows it no handle', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 3), GONE)
    await stampLead(fx, idsOf(fx, 3, 7), WREN)
    const ctx = chapterContext(fx, 6)

    const answer = await readTurns(ctx, ['t1', 't4'])

    expect(answer.note).toBe(LEAD_MARK_NOTE)
    expect(answer.turns.map((turn) => turn.leadMark)).toEqual([
      { gone: true },
      { id: 'c1', name: 'Wren' },
    ])
    expect(ctx.ids.handleOf(GONE)).toBeUndefined()
    expect(JSON.stringify(answer)).not.toContain(GONE)
  })

  it('adds the note when only a later answered turn is marked, gone', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 3), WREN)
    await stampLead(fx, idsOf(fx, 3, 5), GONE)
    await stampLead(fx, idsOf(fx, 5, 7), WREN)

    const answer = await readTurns(chapterContext(fx, 6), ['t2', 't4'])

    expect(Object.keys(answer)).toEqual(['note', 'turns'])
    expect(answer.note).toBe(LEAD_MARK_NOTE)
    expect(answer.turns.map((turn) => 'leadMark' in turn)).toEqual([false, true])
    expect(answer.turns.map((turn) => turn.leadMark)).toEqual([undefined, { gone: true }])
  })

  it('marks a run written with no lead as none', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 3, 7), WREN)

    const answer = await readTurns(chapterContext(fx, 6), ['t1', 't4'])

    expect(answer.turns.map((turn) => turn.leadMark)).toEqual([
      { none: true },
      { id: 'c1', name: 'Wren' },
    ])
  })

  it('walks from no lead on a branch with none, marking its first stamped turn', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria\nof the Ford' })
    await stampLead(fx, idsOf(fx, 0, 7), ARIA)

    const answer = await readTurns(chapterContext(fx, 6), ['t1', 't2'])

    expect(answer.note).toBe(LEAD_MARK_NOTE)
    expect(answer.turns.map((turn) => turn.leadMark)).toEqual([
      { id: 'c1', name: 'Aria of the Ford' },
      undefined,
    ])
  })

  it('walks only the answered turns: a mark on an unread turn adds no note and no handle', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 10), WREN)
    await stampLead(fx, idsOf(fx, 10, 11), ARIA)
    const ctx = chapterContext(fx, 12)

    const answer = await readTurns(ctx, [
      't1',
      't2',
      't3',
      't4',
      't5',
      't6',
      't7',
      't8',
      't9',
      't10',
      't11',
    ])

    expect(Object.keys(answer)).toEqual(['turns', 'unread'])
    expect(answer.unread).toEqual(['t11'])
    expect(ctx.ids.handleOf(ARIA)).toBeUndefined()
  })

  it('answers the marks through dispatch with their handles, the note first', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: ARIA, kind: 'character', name: 'Aria' })
    await putEntityRow(fx, { id: WREN, kind: 'character', name: 'Wren' })
    await flagLead(fx, WREN)
    await stampLead(fx, idsOf(fx, 0, 3), ARIA)
    await stampLead(fx, idsOf(fx, 3, 7), WREN)
    const chapter = idsOf(fx, 0, 7)

    const { answers, ids } = await runDispatchCalls(fx, {
      task: 'awareness',
      tools: { read_turns: readTurnsTool },
      shown: [],
      calls: [{ toolName: 'read_turns', input: { turns: ['t1', 't4'] } }],
      turns: { endEntryId: chapter.at(-1)!, taskEntryIds: chapter, part: 0 },
    })

    const [answer] = answers as TurnsAnswer[]
    expect(Object.keys(answer!)).toEqual(['note', 'turns'])
    expect(answer!.turns.map((turn) => turn.leadMark)).toEqual([
      { id: 'c1', name: 'Aria' },
      { id: 'c2', name: 'Wren' },
    ])
    expect(ids.nameOf('c1')).toBe('Aria')
    expect(JSON.stringify(answers)).not.toContain('char_')
  })
})
