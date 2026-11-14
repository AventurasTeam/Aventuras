import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { readRowGuard } from '@/lib/actions/delta/row-guard'
import { USER_EDITED_SINCE_PROSE, type GuardRow } from '@/lib/actions/types'
import { clampEmbeddedText } from '@/lib/classifier'
import { branches, deltas, lore, type Lore } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { CloseIds } from './ids'
import type { CloseLedgerWriter } from './ledger'
import { createLoreTool, LORE_BODY_LIMIT, updateLoreTool } from './lore-tools'
import { readRowTool } from './read-tools'
import { turnInTextReason } from './text-checks'
import { assertReplaySafe, type CloseTool, type ReadFields, type WriteContext } from './tool'
import { CLOSE_REASON } from './verdict'
import {
  runDispatchCalls,
  shownOf,
  type DispatchRun,
  type DispatchSetup,
  type ScriptedCall,
} from '../__tests__/close-dispatch'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'

// ---- Fixture helpers: lore rows on openCloseFixture and a scripted Lore-task dispatch. ----

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const WREN = 'char_00000000-0000-4000-8000-00000000d001'
const TOLL = 'lore_00000000-0000-4000-8000-00000000d002'
const FERRY = 'lore_00000000-0000-4000-8000-00000000d003'
// Shown and counted as read, never seeded: a row gone since the task read it.
const GONE = 'lore_00000000-0000-4000-8000-00000000d004'
// generateId's shape, as a create mints it.
const MINTED = /^lore_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The chapter: the opening to the third reply, t1…t7. E is that reply. */
const chapterEntryIds = (f: CloseFixture): string[] =>
  f.entries.slice(0, 7).map((entry) => entry.id)
const endEntryId = (f: CloseFixture): string => f.entries[6]!.id

// A lore row's four fields, which the Lore task's read_row returns.
const LORE_FIELDS: ReadFields = { lore: ['title', 'body', 'category', 'keywords'] }

type LoreSeed = Pick<Lore, 'id' | 'title'> & Partial<Pick<Lore, 'body' | 'category' | 'keywords'>>

/** A row a pass created before the chapter: unanchored, under an action no turn owns. */
async function seedLore(f: CloseFixture, seed: LoreSeed): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createLore',
        source: 'periodic_classifier',
        payload: {
          entry: {
            body: 'Paid at the far bank.',
            category: null,
            keywords: [],
            ...seed,
            branchId: f.branchId,
            injectionMode: 'auto',
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
      actionId: 'act_seed_world',
      branchId: f.branchId,
      entryId: null,
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seeding ${seed.title} refused: ${result.reason}`)
}

/** The branch's lore rows, by title. */
function loreRows(f: CloseFixture): Promise<Lore[]> {
  return f.ctx.db.select().from(lore).where(eq(lore.branchId, f.branchId)).orderBy(asc(lore.title))
}

async function storedLore(f: CloseFixture, id: string): Promise<Lore> {
  const [found] = await f.ctx.db
    .select()
    .from(lore)
    .where(and(eq(lore.branchId, f.branchId), eq(lore.id, id)))
  if (found === undefined) throw new Error(`no lore ${id}`)
  return found
}

/** A user's edit lands unanchored after every turn's prose; a later turn's anchors past E. */
async function editLore(
  f: CloseFixture,
  who: 'user' | 'later-turn',
  id: string,
  patch: Partial<Pick<Lore, 'title' | 'body' | 'category' | 'keywords'>>,
): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateLore',
        source: who === 'user' ? 'user_edit' : 'periodic_classifier',
        payload: { branchId: f.branchId, id, patch, proseEntryId: null },
      },
      actionId: who === 'user' ? 'act_user_edit' : 'act_close_turn_5',
      branchId: f.branchId,
      // The fifth reply: past E, under the fixture's act_close_turn_5.
      entryId: who === 'user' ? null : f.replyIds[4]!,
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit of ${id} refused: ${result.reason}`)
}

function runDeltas(f: CloseFixture, actionId: string) {
  return f.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

const cite = (turns: readonly string[] = ['t7'], why = 'The ferryman names the toll.') => ({
  turns: [...turns],
  why,
})

type ShownLore = { id: string; name: string }
/** The ledger's writer rides along, so a case can read its counts after the run. */
type LoreRun = DispatchRun & { writer: CloseLedgerWriter }

const LORE_TOOLS: Readonly<Record<string, CloseTool>> = {
  create_lore: createLoreTool,
  update_lore: updateLoreTool,
  read_row: readRowTool,
}

/** Runs `calls` as the Lore task of `part`; the read set holds only `seeds` (C11). */
async function dispatchScripted(
  f: CloseFixture,
  calls: readonly ScriptedCall[],
  opts: {
    shown?: readonly ShownLore[]
    seeds?: readonly GuardRow[]
    part?: number
    setup?: DispatchSetup
  } = {},
): Promise<LoreRun> {
  let writer: CloseLedgerWriter | undefined
  const run = await runDispatchCalls(f, {
    task: 'lore',
    tools: LORE_TOOLS,
    shown: shownOf(opts.shown ?? []),
    seeds: opts.seeds ?? [],
    calls,
    turns: { endEntryId: endEntryId(f), taskEntryIds: chapterEntryIds(f), part: opts.part ?? 1 },
    readFields: LORE_FIELDS,
    setup: (ids, ledger) => {
      writer = ledger
      opts.setup?.(ids, ledger)
    },
  })
  if (writer === undefined) throw new Error('the scripted phase never ran')
  return { ...run, writer }
}

afterEach(() => {
  resetAllStores()
})

// ---- create_lore ----

describe('create_lore: the tool', () => {
  it('replays as sent, category and keywords optional, with no bound in the schema', () => {
    assertReplaySafe(createLoreTool.schema, [
      { title: 'The toll', body: 'Paid at the far bank.', turns: ['t1'], why: 'It says so.' },
      {
        title: 'The toll',
        body: 'x'.repeat(5_000),
        category: '',
        keywords: [],
        turns: ['t1', 't2'],
        why: 'It says so.',
      },
    ])
  })

  it('takes no id, under its canon name', () => {
    expect(createLoreTool).toMatchObject({ kind: 'write', name: 'create_lore', ids: {} })
  })

  it('holds a body to the embedder’s whole-text bound', () => {
    const over = 'x'.repeat(LORE_BODY_LIMIT + 1)
    expect(clampEmbeddedText({ name: '', description: over }).description).toHaveLength(
      LORE_BODY_LIMIT,
    )
  })
})

describe('create_lore', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
  })

  const create = (input: Record<string, unknown>, turns?: readonly string[]): ScriptedCall => ({
    toolName: 'create_lore',
    input: { ...input, ...cite(turns) },
  })
  const TOLL_INPUT = {
    title: '  The Ferry Toll ',
    body: ' Crossing after dark costs a courier purse, paid at the far bank. ',
    category: ' custom ',
    keywords: ['toll', 'Toll', ' night crossing '],
  }
  const TOLL_BODY = 'Crossing after dark costs a courier purse, paid at the far bank.'

  it('lands a row: priority 0, auto, the body and keywords, one create on E whose handle reads', async () => {
    const run = await dispatchScripted(f, [
      create(TOLL_INPUT),
      { toolName: 'read_row', input: { id: 'lo1' } },
    ])

    const [row] = await loreRows(f)
    expect(row).toMatchObject({
      title: 'The Ferry Toll',
      body: TOLL_BODY,
      category: 'custom',
      keywords: ['toll', 'night crossing'],
      tags: [],
      priority: 0,
      injectionMode: 'auto',
      embeddingStale: 1,
    })
    expect(row!.createdAt).toBe(row!.updatedAt)
    expect(run.answers[0]).toEqual({ result: 'ok', id: 'lo1' })
    expect(run.answers[1]).toMatchObject({
      id: 'lo1',
      kind: 'lore',
      fields: { title: 'The Ferry Toll', category: 'custom' },
    })
    expect(run.calls[0]).toEqual({
      task: 'lore',
      part: 1,
      tool: 'create_lore',
      rows: [{ table: 'lore', id: row!.id, name: 'The Ferry Toll' }],
      why: 'The ferryman names the toll.',
      turns: [endEntryId(f)],
      result: 'ok',
      values: {
        title: 'The Ferry Toll',
        body: TOLL_BODY,
        category: 'custom',
        keywords: 'toll, night crossing',
      },
    })
    const written = await runDeltas(f, run.result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      op: 'create',
      targetTable: 'lore',
      targetId: row!.id,
      source: 'chapter_close',
      entryId: endEntryId(f),
    })
  })

  it('stores a row handle in its body as the name it stands for', async () => {
    await dispatchScripted(
      f,
      [
        create({
          title: 'The courier’s purse',
          body: 'c1 carries the purse the toll is reckoned by.',
        }),
      ],
      { shown: [{ id: WREN, name: 'Wren' }] },
    )

    expect((await loreRows(f)).map(({ body }) => body)).toEqual([
      'Wren carries the purse the toll is reckoned by.',
    ])
  })

  it('refuses a create citing nothing or a turn outside the chapter, or with a blank title or body', async () => {
    const run = await dispatchScripted(
      f,
      [
        create(TOLL_INPUT, []),
        create(TOLL_INPUT, ['t8']),
        create({ ...TOLL_INPUT, body: ' \n\t ' }),
        create({ ...TOLL_INPUT, title: '   ' }),
      ],
      // t8: an entry past E, as read_turns will show one (5.9).
      {
        setup: (ids) => {
          ids.showTurn(f.entries[9]!.id)
        },
      },
    )

    expect(run.answers).toEqual([
      { result: 'rejected', reason: expect.stringMatching(/^turns-empty: turns is empty/) },
      { result: 'rejected', reason: expect.stringMatching(/^turn-not-shown: t8 /) },
      {
        result: 'rejected',
        reason: 'body-blank',
        note: 'Give the row a body: how the thing works or what it is, as the cited turns establish it.',
      },
      {
        result: 'rejected',
        reason: 'title-blank',
        note: 'Give the row a title: the name the story uses for the rule or thing.',
      },
    ])
    expect(await loreRows(f)).toEqual([])
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
    // The common checks' refusals name no row; a refused plan keeps its minted id and title (C4).
    expect(run.calls.map(({ rows }) => rows)).toEqual([
      [],
      [],
      [{ table: 'lore', id: expect.stringMatching(MINTED), name: 'The Ferry Toll' }],
      [{ table: 'lore', id: expect.stringMatching(MINTED), name: '' }],
    ])
    expect(run.calls[2]!.values).toMatchObject({ title: 'The Ferry Toll', body: '' })
  })

  it('refuses a create past the cap, naming it, and keeps its minted id and proposal', async () => {
    const run = await dispatchScripted(f, [
      create({ title: 'The Ferry Toll', body: 'Paid at the far bank.' }),
      create({ title: 'The Night Crossing', body: 'Only Tobin poles across after dark.' }),
      create({ title: 'The Syndicate Sash', body: 'A Syndicate guard wears a sash at the toll.' }),
      create({ title: 'The Second Mark', body: 'A smaller mark under the seal names a reader.' }),
    ])

    expect(run.answers.slice(0, 3)).toEqual([
      { result: 'ok', id: 'lo1' },
      { result: 'ok', id: 'lo2' },
      { result: 'ok', id: 'lo3' },
    ])
    expect(run.answers[3]).toEqual({
      result: 'rejected',
      reason: 'lore-cap',
      note: 'This close has created 3 lore rows, its limit: extend or correct an existing row with update_lore instead.',
    })
    expect(run.calls[3]).toMatchObject({
      result: 'rejected',
      reason: 'lore-cap',
      rows: [{ table: 'lore', id: expect.stringMatching(MINTED), name: 'The Second Mark' }],
      values: {
        title: 'The Second Mark',
        body: 'A smaller mark under the seal names a reader.',
      },
    })
    expect((await loreRows(f)).map(({ title }) => title)).toEqual([
      'The Ferry Toll',
      'The Night Crossing',
      'The Syndicate Sash',
    ])
    expect(run.writer.landedCalls(createLoreTool)).toBe(3)
  })

  it('counts only landed creates toward the cap, an earlier task’s and part’s included', async () => {
    const earlier = (writer: CloseLedgerWriter, result: 'ok' | 'rejected', part: number) =>
      writer.record({
        task: 'lore',
        part,
        tool: 'create_lore',
        rows: [],
        why: 'An earlier part established it.',
        turns: [],
        result,
        ...(result === 'ok' ? {} : { reason: 'lore-cap' }),
      })

    const under = await dispatchScripted(
      f,
      [create({ title: 'The Ferry Toll', body: 'Paid at the far bank.' })],
      {
        part: 2,
        setup: (_ids, writer) => {
          earlier(writer, 'ok', 1)
          earlier(writer, 'ok', 1)
          earlier(writer, 'rejected', 1)
          earlier(writer, 'rejected', 2)
        },
      },
    )
    expect(under.answers[0]).toMatchObject({ result: 'ok' })

    const at = await dispatchScripted(
      f,
      [create({ title: 'The Night Crossing', body: 'Only Tobin poles across after dark.' })],
      {
        part: 2,
        setup: (_ids, writer) => {
          earlier(writer, 'ok', 1)
          earlier(writer, 'ok', 1)
          earlier(writer, 'ok', 2)
        },
      },
    )
    expect(at.answers[0]).toMatchObject({ result: 'rejected', reason: 'lore-cap' })
    expect(at.calls.at(-1)).toMatchObject({ part: 2, result: 'rejected', reason: 'lore-cap' })
    expect((await loreRows(f)).map(({ title }) => title)).toEqual(['The Ferry Toll'])
  })

  it('refuses a title a lore row holds, trimmed and case-folded, naming that row', async () => {
    await seedLore(f, { id: TOLL, title: 'The Ferry Toll' })

    const run = await dispatchScripted(f, [
      create({ title: '  the FERRY toll ', body: 'Crossing after dark costs a courier purse.' }),
      // The refusal shows the holder by name, so prose naming its handle stores the title.
      create({ title: 'The Toll Keeper', body: 'The ferryman collects lo1 at the far bank.' }),
    ])

    expect(run.answers[0]).toEqual({
      result: 'rejected',
      reason: 'title-taken',
      note: 'lo1 already holds this title: read it with read_row, then extend or correct it with update_lore instead of creating a second row.',
    })
    expect(run.calls[0]).toMatchObject({ result: 'rejected', reason: 'title-taken' })
    expect((await loreRows(f)).map(({ id, body }) => [id, body])).toEqual([
      [TOLL, 'Paid at the far bank.'],
      [expect.stringMatching(MINTED), 'The ferryman collects The Ferry Toll at the far bank.'],
    ])
  })

  it('finds a taken title on its own branch only', async () => {
    await f.ctx.db
      .insert(branches)
      .values({ id: 'br_other', storyId: f.storyId, name: 'other', createdAt: 1 })
    await f.ctx.db.insert(lore).values({
      id: TOLL,
      branchId: 'br_other',
      title: 'The Ferry Toll',
      body: 'Paid at the near bank.',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    const run = await dispatchScripted(f, [
      create({ title: 'The Ferry Toll', body: 'Paid at the far bank.' }),
    ])

    expect(run.answers[0]).toEqual({ result: 'ok', id: 'lo1' })
    expect((await loreRows(f)).map(({ title }) => title)).toEqual(['The Ferry Toll'])
  })

  it('refuses a title a lore row holds past the 120-character cut, the stored title cut alike', async () => {
    await seedLore(f, { id: TOLL, title: 't'.repeat(127) })

    const run = await dispatchScripted(f, [
      create({ title: 't'.repeat(127), body: 'Crossing after dark costs a courier purse.' }),
    ])

    expect(run.answers[0]).toMatchObject({ result: 'rejected', reason: 'title-taken' })
    expect((await loreRows(f)).map(({ id }) => id)).toEqual([TOLL])
  })

  it('lands a blank category as null, and leaves it and empty keywords out of values', async () => {
    const run = await dispatchScripted(f, [
      create({
        title: 'The Ferry Toll',
        body: 'Paid at the far bank.',
        category: '  ',
        keywords: [],
      }),
    ])

    expect(run.calls[0]!.values).toEqual({ title: 'The Ferry Toll', body: 'Paid at the far bank.' })
    expect((await loreRows(f)).map(({ category }) => category)).toEqual([null])
  })

  it('cuts a category at 120 characters, as a title is cut', async () => {
    await dispatchScripted(f, [
      create({ title: 'The Ferry Toll', body: 'Paid at the far bank.', category: 'k'.repeat(130) }),
    ])

    expect((await loreRows(f)).map(({ category }) => category)).toEqual(['k'.repeat(120)])
  })

  it('lands a body at the limit and refuses one a character over, naming its length', async () => {
    const run = await dispatchScripted(f, [
      create({ title: 'The Long Toll', body: `  ${'x'.repeat(1_201)} ` }),
      create({ title: 'The Long Toll', body: ` ${'x'.repeat(1_200)}  ` }),
    ])

    expect(run.answers).toEqual([
      {
        result: 'rejected',
        reason:
          'body-over-limit: body is 1201 characters as stored, ids written as names, over the limit of 1200: state the rule in fewer words',
      },
      { result: 'ok', id: 'lo1' },
    ])
    expect((await loreRows(f)).map(({ body }) => body)).toEqual(['x'.repeat(1_200)])
  })

  it('measures a body as stored, a row handle written as its name, and says so', async () => {
    await seedLore(f, { id: TOLL, title: 'The Ferry Toll' })

    // Sent: 1,195 + ' lo1' = 1,199 characters; stored: 1,195 + ' The Ferry Toll' = 1,210.
    const run = await dispatchScripted(
      f,
      [create({ title: 'The Toll Keeper', body: `${'x'.repeat(1_195)} lo1` })],
      { shown: [{ id: TOLL, name: 'The Ferry Toll' }] },
    )

    expect(run.answers[0]).toEqual({
      result: 'rejected',
      reason:
        'body-over-limit: body is 1210 characters as stored, ids written as names, over the limit of 1200: state the rule in fewer words',
    })
  })

  it('refuses a create whose title or body names a turn', async () => {
    const run = await dispatchScripted(f, [
      create({ title: 'The toll of t3', body: 'Paid at the far bank.' }),
      create({ title: 'The Ferry Toll', body: 'Paid at the far bank, as [t5] shows.' }),
    ])

    expect(run.answers).toEqual([
      { result: 'rejected', reason: turnInTextReason('t3') },
      { result: 'rejected', reason: turnInTextReason('t5') },
    ])
    expect(await loreRows(f)).toEqual([])
  })

  it('drops a category naming a turn, or keywords holding a handle, and lands the row', async () => {
    const termReason =
      'keyword-holds-id: the keyword "c1" holds c1, an id: a keyword is a word the prose uses, never an id'

    const run = await dispatchScripted(
      f,
      [
        create({
          title: 'The Ferry Toll',
          body: 'Paid at the far bank.',
          category: 'rule of t2',
          keywords: ['toll'],
        }),
        create({
          title: 'The Night Crossing',
          body: 'Only Tobin poles across after dark.',
          keywords: ['crossing', 'c1'],
        }),
      ],
      { shown: [{ id: WREN, name: 'Wren' }] },
    )

    expect(run.answers).toEqual([
      {
        result: 'ok',
        id: 'lo1',
        notWritten: [{ field: 'category', row: 'lore', reason: turnInTextReason('t2') }],
      },
      {
        result: 'ok',
        id: 'lo2',
        notWritten: [{ field: 'keywords', row: 'lore', reason: termReason }],
      },
    ])
    expect(run.calls.map(({ skippedFields }) => skippedFields)).toEqual([
      [{ field: 'category', reason: 'turn-in-text' }],
      [{ field: 'keywords', reason: 'keyword-holds-id' }],
    ])
    expect(run.calls[0]!.values).toMatchObject({ category: 'rule of t2' })
    expect(
      (await loreRows(f)).map(({ title, category, keywords }) => [title, category, keywords]),
    ).toEqual([
      ['The Ferry Toll', null, ['toll']],
      ['The Night Crossing', null, []],
    ])
  })
})

// ---- update_lore ----

describe('update_lore: the tool', () => {
  it('replays as sent, its keywords a strict object of two optional lists', () => {
    assertReplaySafe(updateLoreTool.schema, [
      { id: 'lo1', turns: ['t1'], why: 'It says so.' },
      {
        id: 'lo1',
        title: 'The toll',
        body: 'Paid at the bank.',
        category: '',
        keywords: { add: ['toll'], remove: [] },
        turns: ['t1', 't2'],
        why: 'It says so.',
      },
      { id: 'lo1', keywords: {}, turns: ['t3'], why: 'It says so.' },
    ])
    expect(
      updateLoreTool.schema.safeParse({
        id: 'lo1',
        keywords: { add: [], replace: [] },
        turns: ['t1'],
        why: 'It says so.',
      }).success,
    ).toBe(false)
  })

  it("tells the model it can't see a keyword's author, and what removing a user's term costs", () => {
    const { remove } = updateLoreTool.schema.shape.keywords.unwrap().shape
    expect(remove.description).toBe(
      "Terms that no longer fit. You can't see who added a term; removing one the user added is refused, and this call's adds with it.",
    )
    expect(updateLoreTool.description).toContain(
      "You can't see who added a keyword; removing one the user added is refused, naming it, and the call's keyword adds with it, while its other fields land.",
    )
    expect(updateLoreTool.description).not.toContain('Never remove')
  })

  it('takes one lore id, under its canon name', () => {
    expect(updateLoreTool).toMatchObject({
      kind: 'write',
      name: 'update_lore',
      ids: { id: { shape: 'single', prefixes: ['lore_'] } },
    })
  })
})

describe('update_lore', () => {
  let f: CloseFixture

  // The Ferry Toll, a pass's row: its keywords are an AI's, so a close may remove them.
  beforeEach(async () => {
    f = await openCloseFixture()
    await seedLore(f, {
      id: TOLL,
      title: 'The Ferry Toll',
      body: 'Paid at the far bank.',
      category: 'custom',
      keywords: ['toll', 'night crossing'],
    })
  })

  const SHOWN: readonly ShownLore[] = [{ id: TOLL, name: 'The Ferry Toll' }]
  const read: ScriptedCall = { toolName: 'read_row', input: { id: 'lo1' } }
  const update = (input: Record<string, unknown>): ScriptedCall => ({
    toolName: 'update_lore',
    input: { id: 'lo1', ...input, ...cite() },
  })

  it('refuses a row the title list showed until read_row reads it, then lands the call', async () => {
    const call = update({ category: 'tolls' })

    const run = await dispatchScripted(f, [call, read, call], { shown: SHOWN })

    expect(run.answers[0]).toEqual({
      result: 'rejected',
      reason: "unread: lo1 hasn't been read in this task: call read_row on it, then write it",
    })
    expect(run.answers[2]).toEqual({ result: 'ok' })
    expect(run.calls[2]).toEqual({
      task: 'lore',
      part: 1,
      tool: 'update_lore',
      rows: [{ table: 'lore', id: TOLL, name: 'The Ferry Toll' }],
      why: 'The ferryman names the toll.',
      turns: [endEntryId(f)],
      result: 'ok',
      values: { category: 'tolls' },
    })
    expect((await storedLore(f, TOLL)).category).toBe('tolls')
    const written = await runDeltas(f, run.result.actionId)
    expect(written).toHaveLength(1)
    expect(written[0]).toMatchObject({
      op: 'update',
      targetTable: 'lore',
      targetId: TOLL,
      source: 'chapter_close',
      entryId: endEntryId(f),
      undoPayload: { category: 'custom' },
    })
  })

  it('lands a free category beside a body the user edited after the cited turn, ok naming it', async () => {
    await editLore(f, 'user', TOLL, { body: 'The user wrote this.' })

    const run = await dispatchScripted(
      f,
      [read, update({ body: 'The toll doubles after dark.', category: 'tolls' })],
      { shown: SHOWN },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      values: { body: 'The toll doubles after dark.', category: 'tolls' },
      skippedFields: [{ field: 'body', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect(await storedLore(f, TOLL)).toMatchObject({
      body: 'The user wrote this.',
      category: 'tolls',
    })
  })

  it('skips a body the user edited after the cited turn, sent alone', async () => {
    await editLore(f, 'user', TOLL, { body: 'The user wrote this.' })

    const run = await dispatchScripted(
      f,
      [read, update({ body: 'The toll doubles after dark.' })],
      {
        shown: SHOWN,
      },
    )

    expect(run.answers[1]).toEqual({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      note: 'The user edited this after the cited turns; their value stands. Do not write it again.',
    })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('reads a protected text restated as ok, not skipped, alone or beside a free field', async () => {
    await editLore(f, 'user', TOLL, { body: 'The user wrote this.' })

    const run = await dispatchScripted(
      f,
      [
        read,
        update({ body: 'The user wrote this.' }),
        update({ body: ' The user wrote this. ', category: 'tolls' }),
      ],
      { shown: SHOWN },
    )

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(run.answers[2]).toEqual({ result: 'ok' })
    expect(run.calls[2]).not.toHaveProperty('skippedFields')
    expect(run.calls[2]!.values).toEqual({ category: 'tolls' })
  })

  it('reads keywords a later turn wrote, restated, as ok, not skipped', async () => {
    await editLore(f, 'later-turn', TOLL, { keywords: ['toll', 'ferry'] })

    const run = await dispatchScripted(f, [read, update({ keywords: { add: ['Ferry'] } })], {
      shown: SHOWN,
    })

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('skips a protected text before a rule refuses it', async () => {
    await editLore(f, 'user', TOLL, { body: 'The user wrote this.' })
    await editLore(f, 'later-turn', TOLL, { category: 'river' })

    const run = await dispatchScripted(
      f,
      [read, update({ body: 'As t5 shows, the toll doubles.' }), update({ category: 'tolls' })],
      { shown: SHOWN },
    )

    expect(run.answers[1]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(run.answers[2]).toMatchObject({ result: 'skipped', reason: CLOSE_REASON.laterTurn })
  })

  it('reads stored values as ok, nothing written', async () => {
    const run = await dispatchScripted(
      f,
      [
        read,
        update({
          title: ' The Ferry Toll ',
          body: 'Paid at the far bank.',
          category: 'custom',
          keywords: { add: ['TOLL'], remove: ['the far bank'] },
        }),
      ],
      { shown: SHOWN },
    )

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(run.calls[1]).not.toHaveProperty('values')
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('reads a blank body as omitted beside a free field', async () => {
    const run = await dispatchScripted(f, [read, update({ body: '  \n ', category: 'tolls' })], {
      shown: SHOWN,
    })

    expect(run.calls[1]).toMatchObject({ result: 'ok' })
    expect(run.calls[1]!.values).toEqual({ category: 'tolls' })
    expect(run.calls[1]).not.toHaveProperty('skippedFields')
    expect(await storedLore(f, TOLL)).toMatchObject({
      body: 'Paid at the far bank.',
      category: 'tolls',
    })
  })

  it('cuts a category at 120 characters, as a title is cut', async () => {
    const run = await dispatchScripted(f, [read, update({ category: 'k'.repeat(121) })], {
      shown: SHOWN,
    })

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect((await storedLore(f, TOLL)).category).toBe('k'.repeat(120))
  })

  it('adds and removes keywords beside a text field, one action each in one group', async () => {
    const run = await dispatchScripted(
      f,
      [
        read,
        update({
          body: 'The toll doubles after dark.',
          keywords: { add: ['the far bank', 'Toll'], remove: ['NIGHT CROSSING'] },
        }),
      ],
      { shown: SHOWN },
    )

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(run.calls[1]!.values).toEqual({
      body: 'The toll doubles after dark.',
      keywords: 'toll, the far bank',
    })
    expect(await storedLore(f, TOLL)).toMatchObject({
      body: 'The toll doubles after dark.',
      keywords: ['toll', 'the far bank'],
    })
    const written = await runDeltas(f, run.result.actionId)
    expect(written.map(({ undoPayload }) => undoPayload)).toEqual([
      { body: 'Paid at the far bank.' },
      { keywords: ['toll', 'night crossing'] },
    ])
  })

  it('lands the body beside a removal of a term the user added, ok naming the keywords', async () => {
    await editLore(f, 'user', TOLL, { keywords: ['toll', 'night crossing', 'the toll'] })

    const run = await dispatchScripted(
      f,
      [read, update({ body: 'The toll doubles after dark.', keywords: { remove: ['the toll'] } })],
      { shown: SHOWN },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'keywords', reason: 'keyword-user-added' }],
    })
    expect(await storedLore(f, TOLL)).toMatchObject({
      body: 'The toll doubles after dark.',
      keywords: ['toll', 'night crossing', 'the toll'],
    })
  })

  it('skips keywords a later turn wrote, landing the text beside them', async () => {
    await editLore(f, 'later-turn', TOLL, { keywords: ['toll', 'ferry'] })

    const run = await dispatchScripted(
      f,
      [read, update({ category: 'tolls', keywords: { add: ['night'] } })],
      { shown: SHOWN },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'keywords', reason: CLOSE_REASON.laterTurn }],
    })
    expect(await storedLore(f, TOLL)).toMatchObject({
      category: 'tolls',
      keywords: ['toll', 'ferry'],
    })
  })

  it('refuses keywords naming a term in both lists, landing the text beside them', async () => {
    const run = await dispatchScripted(
      f,
      [read, update({ category: 'tolls', keywords: { add: ['Gate'], remove: ['gate '] } })],
      { shown: SHOWN },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'keywords', reason: 'keyword-in-both' }],
    })
    expect(await storedLore(f, TOLL)).toMatchObject({
      category: 'tolls',
      keywords: ['toll', 'night crossing'],
    })
  })

  it('refuses keywords holding a handle, landing the text beside them', async () => {
    const run = await dispatchScripted(
      f,
      [read, update({ category: 'tolls', keywords: { add: ['c1'] } })],
      { shown: [...SHOWN, { id: WREN, name: 'Wren' }] },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'keywords', reason: 'keyword-holds-id' }],
    })
    expect((await storedLore(f, TOLL)).keywords).toEqual(['toll', 'night crossing'])
  })

  it('answers ok writing nothing for a handle-like removal the list lacks', async () => {
    const run = await dispatchScripted(f, [read, update({ keywords: { remove: ['c1'] } })], {
      shown: [...SHOWN, { id: WREN, name: 'Wren' }],
    })

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('refuses keywords with neither list as nothing to write', async () => {
    const run = await dispatchScripted(f, [read, update({ keywords: {} })], { shown: SHOWN })

    expect(run.answers[1]).toEqual({
      result: 'rejected',
      reason:
        'nothing-sent: nothing to write: send a title, a body, a category or keywords to add or remove',
    })
    expect(await runDeltas(f, run.result.actionId)).toEqual([])
  })

  it('refuses a text field naming a turn, landing the fields beside it', async () => {
    const run = await dispatchScripted(
      f,
      [
        read,
        update({ body: 'As t5 shows, the toll doubles after dark.', category: 'tolls' }),
        update({ title: 'The toll of [t3]' }),
      ],
      { shown: SHOWN },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'body', reason: 'turn-in-text' }],
    })
    expect(run.answers[2]).toEqual({ result: 'rejected', reason: turnInTextReason('t3') })
    expect(await storedLore(f, TOLL)).toMatchObject({
      title: 'The Ferry Toll',
      body: 'Paid at the far bank.',
      category: 'tolls',
    })
  })

  it.each([
    [3_000, 4_200, 4_201],
    [100, 1_300, 1_301],
  ])(
    'grows a stored body of %i characters to %i and refuses %i',
    async (stored, lands, refused) => {
      await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: 'b'.repeat(stored) })

      const run = await dispatchScripted(
        f,
        [read, update({ body: 'x'.repeat(refused) }), update({ body: 'x'.repeat(lands) })],
        { shown: [{ id: FERRY, name: 'The Night Ferry' }] },
      )

      expect(run.answers[1]).toEqual({
        result: 'rejected',
        reason: `body-growth: body is ${refused} characters as stored, ids written as names: a body over 1200 may grow the body as it stood before this close (${stored}) by at most 1200, so send a shorter one`,
      })
      expect(run.answers[2]).toEqual({ result: 'ok' })
      expect((await storedLore(f, FERRY)).body).toBe('x'.repeat(lands))
    },
  )

  const growthRefusal = (length: number, base: number): string =>
    `body-growth: body is ${length} characters as stored, ids written as names: a body over 1200 may grow the body as it stood before this close (${base}) by at most 1200, so send a shorter one`

  it("grows a body by 1200 in all across one part's calls, from the body before the close", async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: 'b'.repeat(100) })

    const run = await dispatchScripted(
      f,
      [
        read,
        update({ title: 'The Midnight Ferry' }),
        update({ body: 'x'.repeat(1_300) }),
        update({ body: 'y'.repeat(1_400) }),
        update({ body: 'z'.repeat(1_300) }),
      ],
      { shown: [{ id: FERRY, name: 'The Night Ferry' }] },
    )

    expect(run.answers.slice(1)).toEqual([
      { result: 'ok' },
      { result: 'ok' },
      { result: 'rejected', reason: growthRefusal(1_400, 100) },
      { result: 'ok' },
    ])
    expect((await storedLore(f, FERRY)).body).toBe('z'.repeat(1_300))
  })

  it('grows a body by 1200 in all across parts', async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: 'b'.repeat(100) })

    const run = await dispatchScripted(
      f,
      [
        read,
        update({ body: 'x'.repeat(1_300) }),
        { ...update({ body: 'y'.repeat(1_400) }), part: 2 },
      ],
      { shown: [{ id: FERRY, name: 'The Night Ferry' }] },
    )

    const updates = run.calls.filter(({ tool }) => tool === 'update_lore')
    expect(updates.map(({ part, result }) => [part, result])).toEqual([
      [1, 'ok'],
      [2, 'rejected'],
    ])
    expect(run.answers[2]).toEqual({ result: 'rejected', reason: growthRefusal(1_400, 100) })
    expect((await storedLore(f, FERRY)).body).toBe('x'.repeat(1_300))
  })

  it('grows a row whose body was null before the close from no body at all', async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: null })

    const run = await dispatchScripted(
      f,
      [
        read,
        update({ body: 'x'.repeat(1_000) }),
        update({ body: 'y'.repeat(1_201) }),
        update({ body: 'z'.repeat(1_200) }),
      ],
      { shown: [{ id: FERRY, name: 'The Night Ferry' }] },
    )

    expect(run.answers.slice(1)).toEqual([
      { result: 'ok' },
      { result: 'rejected', reason: growthRefusal(1_201, 0) },
      { result: 'ok' },
    ])
    expect((await storedLore(f, FERRY)).body).toBe('z'.repeat(1_200))
  })

  it('grows a row this close created from no body at all', async () => {
    const run = await dispatchScripted(f, [
      {
        toolName: 'create_lore',
        input: { title: 'The Second Mark', body: 'm'.repeat(1_000), ...cite() },
      },
      update({ body: 'x'.repeat(1_200) }),
      update({ body: 'y'.repeat(1_201) }),
    ])

    expect(run.answers).toEqual([
      { result: 'ok', id: 'lo1' },
      { result: 'ok' },
      { result: 'rejected', reason: growthRefusal(1_201, 0) },
    ])
  })

  it('refuses a title another lore row holds, trimmed and case-folded, landing the category beside it', async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry' })
    const taken = `title-taken: lo2 already holds this title: keep this row's title, or extend or correct lo2 with update_lore`
    let runIds: CloseIds | undefined

    const run = await dispatchScripted(
      f,
      [
        read,
        update({ title: '  the night FERRY ', category: 'tolls' }),
        update({ title: 'The Night Ferry' }),
      ],
      { shown: SHOWN, setup: (ids) => (runIds = ids) },
    )

    expect(run.answers.slice(1)).toEqual([
      { result: 'ok', notWritten: [{ field: 'title', row: 'lo1', reason: taken }] },
      { result: 'rejected', reason: taken },
    ])
    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'title', reason: 'title-taken' }],
    })
    expect(JSON.stringify(run.calls[1])).not.toContain(FERRY)
    expect(run.calls[2]).toMatchObject({ result: 'rejected', reason: 'title-taken' })
    expect(JSON.stringify(run.calls[2])).not.toContain(FERRY)
    expect(await storedLore(f, TOLL)).toMatchObject({ title: 'The Ferry Toll', category: 'tolls' })
    // Shown by name, so prose naming lo2 stores the holder's title.
    expect(runIds?.nameOfId(FERRY)).toBe('The Night Ferry')
  })

  it('refuses a title another lore row holds past the 120-character cut, the stored title cut alike', async () => {
    await seedLore(f, { id: FERRY, title: 't'.repeat(127) })
    const taken = `title-taken: lo2 already holds this title: keep this row's title, or extend or correct lo2 with update_lore`

    const run = await dispatchScripted(f, [read, update({ title: 't'.repeat(127) })], {
      shown: SHOWN,
    })

    expect(run.answers[1]).toEqual({ result: 'rejected', reason: taken })
    expect((await storedLore(f, TOLL)).title).toBe('The Ferry Toll')
  })

  it('measures each row from its own body before the close', async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: 'b'.repeat(3_000) })

    // The Ferry Toll's body is 21 characters before the close; the Night Ferry's 3,000.
    const run = await dispatchScripted(
      f,
      [
        read,
        update({ body: 'x'.repeat(1_221) }),
        { toolName: 'read_row', input: { id: 'lo2' } },
        { toolName: 'update_lore', input: { id: 'lo2', body: 'y'.repeat(4_200), ...cite() } },
      ],
      { shown: [...SHOWN, { id: FERRY, name: 'The Night Ferry' }] },
    )

    expect(run.answers).toEqual([
      expect.anything(),
      { result: 'ok' },
      expect.anything(),
      { result: 'ok' },
    ])
    expect((await storedLore(f, TOLL)).body).toBe('x'.repeat(1_221))
    expect((await storedLore(f, FERRY)).body).toBe('y'.repeat(4_200))
  })

  it('lands its own title in another case: a row never takes its own title', async () => {
    const run = await dispatchScripted(f, [read, update({ title: 'the ferry TOLL' })], {
      shown: SHOWN,
    })

    expect(run.answers[1]).toEqual({ result: 'ok' })
    expect((await storedLore(f, TOLL)).title).toBe('the ferry TOLL')
  })

  it('lands a free title beside a body grown past the bound', async () => {
    await seedLore(f, { id: FERRY, title: 'The Night Ferry', body: 'b'.repeat(100) })

    const run = await dispatchScripted(
      f,
      [read, update({ title: 'The Midnight Ferry', body: 'x'.repeat(1_301) })],
      { shown: [{ id: FERRY, name: 'The Night Ferry' }] },
    )

    expect(run.calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'body', reason: 'body-growth' }],
    })
    expect(await storedLore(f, FERRY)).toMatchObject({
      title: 'The Midnight Ferry',
      body: 'b'.repeat(100),
    })
  })

  it('writes a row this task created with no read_row', async () => {
    const run = await dispatchScripted(f, [
      {
        toolName: 'create_lore',
        input: {
          title: 'The Second Mark',
          body: 'A smaller mark under the seal names a reader.',
          ...cite(),
        },
      },
      update({ category: 'seals' }),
    ])

    expect(run.answers).toEqual([{ result: 'ok', id: 'lo1' }, { result: 'ok' }])
    const created = (await loreRows(f)).find(({ title }) => title === 'The Second Mark')
    expect(created?.category).toBe('seals')
  })

  it('names a retitled row by its new title in a later write', async () => {
    const run = await dispatchScripted(
      f,
      [
        read,
        update({ title: 'The Midnight Toll' }),
        {
          toolName: 'create_lore',
          input: { title: 'The Toll Gate', body: 'Unlike lo1, it bars the crossing.', ...cite() },
        },
      ],
      { shown: SHOWN },
    )

    expect(run.answers[2]).toEqual({ result: 'ok', id: 'lo2' })
    const gate = (await loreRows(f)).find(({ title }) => title === 'The Toll Gate')
    expect(gate?.body).toBe('Unlike The Midnight Toll, it bars the crossing.')
  })

  it('anchors both actions on the latest cited turn, not E', async () => {
    // t5, before E (t7): a user edit between the two is the user's after the prose.
    const t5 = f.entries[4]!.id
    const ctx: WriteContext = {
      db: f.ctx.db,
      branchId: f.branchId,
      endEntryId: endEntryId(f),
      task: 'lore',
      part: 1,
      taskEntryIds: chapterEntryIds(f),
      ids: new CloseIds(),
      readFields: LORE_FIELDS,
      survivorOf: () => undefined,
      clusterOf: () => undefined,
      landedCalls: () => 0,
      turns: [t5],
      proseEntryId: t5,
      guard: (rows) =>
        readRowGuard(
          { branchId: f.branchId, endEntryId: endEntryId(f), proseEntryId: t5, rows },
          f.ctx,
        ),
      actionId: 'act_close_plan',
    }

    const plan = await updateLoreTool.plan(
      {
        id: TOLL,
        body: 'The toll doubles after dark.',
        keywords: { add: ['ferry'] },
        ...cite(['t5']),
      },
      ctx,
    )

    expect(plan.kind === 'write' && plan.actions.map(({ action }) => action.payload)).toEqual([
      expect.objectContaining({ proseEntryId: t5 }),
      expect.objectContaining({ proseEntryId: t5 }),
    ])
  })

  it('refuses a row gone since it was read, keeping the proposed text', async () => {
    const run = await dispatchScripted(f, [update({ body: 'The toll doubles after dark.' })], {
      shown: [{ id: GONE, name: 'The Old Toll' }],
      seeds: [{ table: 'lore', id: GONE }],
    })

    expect(run.answers[0]).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      note: 'The row is gone; do not write to it again.',
    })
    expect(run.calls[0]).toMatchObject({
      rows: [{ table: 'lore', id: GONE, name: 'The Old Toll' }],
      values: { body: 'The toll doubles after dark.' },
    })
  })

  // After a fork another branch can still hold a row this one deleted, under the same id.
  it('refuses a row only another branch holds as gone, though that row reads as sent', async () => {
    await f.ctx.db
      .insert(branches)
      .values({ id: 'br_other', storyId: f.storyId, name: 'other', createdAt: 1 })
    await f.ctx.db.insert(lore).values({
      id: GONE,
      branchId: 'br_other',
      title: 'The Old Toll',
      body: 'The toll doubles after dark.',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })

    const run = await dispatchScripted(f, [update({ body: 'The toll doubles after dark.' })], {
      shown: [{ id: GONE, name: 'The Old Toll' }],
      seeds: [{ table: 'lore', id: GONE }],
    })

    expect(run.answers[0]).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      note: 'The row is gone; do not write to it again.',
    })
  })
})
