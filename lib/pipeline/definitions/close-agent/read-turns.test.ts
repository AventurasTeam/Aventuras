import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

import { branches, deltas, storyEntries } from '@/lib/db'
import { generateId } from '@/lib/ids'
import { entriesStore, resetAllStores } from '@/lib/stores'

import { CloseIds } from './ids'
import { readTurnsTool } from './read-turns'
import { assertReplaySafe, type ToolContext } from './tool'
import { runDispatchCalls } from '../__tests__/close-dispatch'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

const WREN = 'char_00000000-0000-4000-8000-000000000001'
// The fixture's opening, first action, first reply and third reply (close-fixture.ts).
const OPENING = /^Rain had followed Wren from the coast for three days/
const FIRST_ACTION = 'I tie the mare outside the inn and shake the rain from my hood.'
const FIRST_REPLY = /^The inn is warm and loud with drovers\./
const THIRD_REPLY = /^The landing is a black line of planks over black water\./

type TurnsAnswer = {
  turns: { id: string; kind: string; prose: string }[]
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
    expect(entriesStore.getById(fx.entries.at(-1)!.id)).toBeDefined()
    expect(entriesStore.getById(fx.entries[0]!.id)).toBeUndefined()

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
