import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import type { GroupOutcome, GuardRow } from '@/lib/actions/types'
import { deltas, lore, type Lore } from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext } from './dispatch'
import type { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { createLoreTool } from './lore-tools'
import { readRowTool } from './read-tools'
import { turnInTextReason } from './text-checks'
import { assertReplaySafe, type CloseTool, type ReadFields } from './tool'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { runPipeline } from '../../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, TxResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

// ---- Fixture helpers: lore rows on openCloseFixture and a scripted Lore-task dispatch. ----

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const WREN = 'char_00000000-0000-4000-8000-00000000d001'
const TOLL = 'lore_00000000-0000-4000-8000-00000000d002'
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

type ScriptedCall = { toolName: string; input: Record<string, unknown> }
type ShownRow = { id: string; name: string }
type LoreRun = {
  result: TxResult
  /** What each call answered the model, in order. */
  answers: readonly unknown[]
  /** The ledger: what `setup` recorded, then each scripted call. */
  calls: CloseLedger['calls']
  writer: CloseLedgerWriter
}
type Pending = {
  fixture: CloseFixture
  calls: readonly ScriptedCall[]
  shown: readonly ShownRow[]
  seeds: readonly GuardRow[]
  part: number
  setup?: (ids: CloseIds, writer: CloseLedgerWriter) => void
  answers: unknown[]
  ledger?: CloseLedger
  writer?: CloseLedgerWriter
}

const SCRIPTED_KIND = 'close-lore-tools-test'
const LORE_TOOLS: Readonly<Record<string, CloseTool>> = {
  create_lore: createLoreTool,
  read_row: readRowTool,
}

let pending: Pending | undefined

// Stands where the Lore task will: the run's ids and ledger, the shown rows' handles, and a read set
// holding only `seeds`, since Lore's start shows titles and seeds nothing (C11).
async function* scriptedPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = pending
  if (run === undefined) throw new Error('no scripted lore calls')
  const f = run.fixture
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(chapterEntryIds(f))
  for (const { id, name } of run.shown) ids.show(id, name)
  const ledger = seedCloseLedger(phase.intermediates)
  run.ledger = ledger
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), phase.actionId)
  run.writer = writer
  run.setup?.(ids, writer)
  const readSet = createReadSet()
  readSet.add(run.seeds)
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: endEntryId(f),
    task: 'lore',
    part: run.part,
    ids,
    readFields: LORE_FIELDS,
    survivorOf: (table, id) => writer.survivorOf(table, id),
    landedCalls: (tool) => writer.landedCalls(tool),
    phase,
    taskEntryIds: chapterEntryIds(f),
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of run.calls.entries()) {
    const tool = LORE_TOOLS[toolName]
    if (tool === undefined) throw new Error(`no lore test tool ${toolName}`)
    const answer = yield* dispatchToolCall(
      { toolCallId: `call_${index + 1}`, toolName, input },
      tool,
      ctx,
    )
    run.answers.push(answer.output)
  }
  return { status: 'completed' }
}

/** Runs `calls` through dispatchToolCall in one close-like run, as the Lore task of `part`. */
async function dispatchScripted(
  f: CloseFixture,
  calls: readonly ScriptedCall[],
  opts: {
    shown?: readonly ShownRow[]
    seeds?: readonly GuardRow[]
    part?: number
    setup?: Pending['setup']
  } = {},
): Promise<LoreRun> {
  if (getPipelineSafe(SCRIPTED_KIND) === undefined)
    definePipeline({
      kind: SCRIPTED_KIND,
      phases: [{ name: 'agent', run: scriptedPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  const run: Pending = {
    fixture: f,
    calls,
    shown: opts.shown ?? [],
    seeds: opts.seeds ?? [],
    part: opts.part ?? 1,
    ...(opts.setup === undefined ? {} : { setup: opts.setup }),
    answers: [],
  }
  pending = run
  try {
    const result = expectRan(
      await runPipeline(SCRIPTED_KIND, {
        storyId: f.storyId,
        branchId: f.branchId,
        db: f.ctx.db,
        runInTransaction: f.ctx.runInTransaction,
      }),
    )
    expect(result.outcome).toBe('completed')
    if (run.ledger === undefined || run.writer === undefined)
      throw new Error('the scripted phase never ran')
    return { result, answers: run.answers, calls: run.ledger.calls, writer: run.writer }
  } finally {
    pending = undefined
  }
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
      { result: 'rejected', reason: expect.stringMatching(/^turns is empty/) },
      { result: 'rejected', reason: expect.stringMatching(/^t8 /) },
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
    expect(run.writer.landedCalls('create_lore')).toBe(3)
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

  it('lands a body at the limit and refuses one a character over, naming its length', async () => {
    const run = await dispatchScripted(f, [
      create({ title: 'The Long Toll', body: `  ${'x'.repeat(1_201)} ` }),
      create({ title: 'The Long Toll', body: ` ${'x'.repeat(1_200)}  ` }),
    ])

    expect(run.answers).toEqual([
      {
        result: 'rejected',
        reason: 'body is 1201 characters, over the limit of 1200: state the rule in fewer words',
      },
      { result: 'ok', id: 'lo1' },
    ])
    expect((await loreRows(f)).map(({ body }) => body)).toEqual(['x'.repeat(1_200)])
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
      'the keyword "c1" holds c1, an id: a keyword is a word the prose uses, never an id'

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
      [{ field: 'category', reason: turnInTextReason('t2') }],
      [{ field: 'keywords', reason: termReason }],
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
