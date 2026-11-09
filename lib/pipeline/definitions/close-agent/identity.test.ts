import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { USER_EDITED_SINCE_PROSE, type DeltaSource, type GroupOutcome } from '@/lib/actions/types'
import {
  deltas,
  emptyEntityState,
  entities,
  type Entity,
  type EntityState,
  type NewEntity,
} from '@/lib/db'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext, type ToolAnswer } from './dispatch'
import { softCapReason } from './fields'
import { updateCharacterTool, updateFactionTool } from './identity-tools'
import type { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { assertReplaySafe, type CloseTool } from './tool'
import { CLOSE_REASON } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { runPipeline } from '../../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, TxResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeIdsOf, seedCloseLedger } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

// ---- Fixture helpers: a cast on openCloseFixture and a scripted dispatch context. ----

// Real `prefix_<uuid>` ids: CloseIds.show allocates handles for those only.
const WREN = 'char_00000000-0000-4000-8000-00000000b001'
const TOBIN = 'char_00000000-0000-4000-8000-00000000b002'
const SYNDICATE = 'fact_00000000-0000-4000-8000-00000000b003'
// Shown to the model, never seeded: a row an earlier merge absorbed.
const GONE = 'char_00000000-0000-4000-8000-00000000b004'
const SCRIBE = 'char_00000000-0000-4000-8000-00000000b005'

const WREN_STATE = { traits: ['patient'], drives: ['deliver the letter'], voice: 'soft' }

/** `n` distinct list entries: `trait 1`, `trait 2`… */
const terms = (word: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${word} ${i + 1}`)

/** The chapter: the opening to the third reply, t1…t7. E is that reply. */
const chapterEntryIds = (f: CloseFixture): string[] =>
  f.entries.slice(0, 7).map((entry) => entry.id)
const endEntryId = (f: CloseFixture): string => f.entries[6]!.id
/** The fifth reply: past E, under the fixture's act_close_turn_5. */
const laterReplyId = (f: CloseFixture): string => f.replyIds[4]!

type SeedSpec = {
  id: string
  kind: NewEntity['kind']
  name: string
  description?: string | null
  status?: NewEntity['status']
  keywords?: string[]
  /** Merged over the kind's empty state. */
  state?: Readonly<Record<string, unknown>>
}

/** A row a pass created before the chapter: unanchored, under an action no turn owns. */
async function seedEntity(f: CloseFixture, spec: SeedSpec): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            id: spec.id,
            branchId: f.branchId,
            kind: spec.kind,
            name: spec.name,
            description: spec.description ?? null,
            status: spec.status ?? 'active',
            injectionMode: 'auto',
            keywords: spec.keywords ?? [],
            state: { ...emptyEntityState(spec.kind), ...spec.state } as EntityState,
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
  if (result.status !== 'ok') throw new Error(`seeding ${spec.name} refused: ${result.reason}`)
}

type ShownRow = { id: string; name: string }

/** Wren, Tobin and the Syndicate, shown in that order: c1, c2, f1. */
const CAST: readonly ShownRow[] = [
  { id: WREN, name: 'Wren' },
  { id: TOBIN, name: 'Tobin' },
  { id: SYNDICATE, name: 'the Syndicate' },
]

/** Wren as WREN_STATE; Tobin with 12 traits and no description; the Syndicate with a standing. */
async function seedCast(f: CloseFixture): Promise<void> {
  await seedEntity(f, {
    id: WREN,
    kind: 'character',
    name: 'Wren',
    description: 'A courier.',
    state: WREN_STATE,
  })
  await seedEntity(f, {
    id: TOBIN,
    kind: 'character',
    name: 'Tobin',
    state: { traits: terms('trait', 12) },
  })
  await seedEntity(f, {
    id: SYNDICATE,
    kind: 'faction',
    name: 'the Syndicate',
    description: 'They hold the road.',
    state: { standing: 'feared on the river', agenda: ['tax the ferry'] },
  })
}

type Editor = 'user' | 'later-turn' | 'earlier-close'

// user: after every turn's prose, unanchored. later-turn: anchored past E, a turn's own source.
// earlier-close: a chapter_close delta anchored past E, which C12 never counts as a later turn's.
const EDITORS: Readonly<Record<Editor, { source: DeltaSource; actionId: string; past: boolean }>> =
  {
    user: { source: 'user_edit', actionId: 'act_user_edit', past: false },
    'later-turn': { source: 'per_turn_classifier', actionId: 'act_close_turn_5', past: true },
    'earlier-close': { source: 'chapter_close', actionId: 'act_earlier_close', past: true },
  }

async function storedEntity(f: CloseFixture, id: string): Promise<Entity> {
  const [found] = await f.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, f.branchId), eq(entities.id, id)))
  if (found === undefined) throw new Error(`no entity ${id}`)
  return found
}

/** Writes the whole state with `patch.state` merged in, as the World editor and a pass do. */
async function editEntity(
  f: CloseFixture,
  id: string,
  who: Editor,
  patch: { description?: string; state?: Readonly<Record<string, unknown>> },
): Promise<void> {
  const current = await storedEntity(f, id)
  const editor = EDITORS[who]
  const state =
    patch.state === undefined
      ? undefined
      : ({ ...(current.state ?? emptyEntityState(current.kind)), ...patch.state } as EntityState)
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'updateEntity',
        source: editor.source,
        payload: {
          branchId: f.branchId,
          id,
          patch: {
            ...(patch.description === undefined ? {} : { description: patch.description }),
            ...(state === undefined ? {} : { state }),
          },
        },
      },
      actionId: editor.actionId,
      branchId: f.branchId,
      entryId: editor.past ? laterReplyId(f) : null,
    },
    f.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${who} edit refused: ${result.reason}`)
}

function runDeltas(f: CloseFixture, actionId: string) {
  return f.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.actionId, actionId))
    .orderBy(asc(deltas.logPosition))
}

const cite = (turns: readonly string[] = ['t7'], why = 'The rain and the crossing show it.') => ({
  turns: [...turns],
  why,
})

type ScriptedCall = { toolName: string; input: Record<string, unknown> }
type DispatchRun = {
  result: TxResult
  /** Each scripted call's answer, in order. */
  answers: readonly ToolAnswer[]
  /** The ledger: what `setup` recorded, then each scripted call. */
  calls: CloseLedger['calls']
}

const SCRIPTED_KIND = 'close-identity-test'
const IDENTITY_TOOLS: Readonly<Record<string, CloseTool>> = {
  update_character: updateCharacterTool,
  update_faction: updateFactionTool,
}

let pending:
  | {
      fixture: CloseFixture
      calls: readonly ScriptedCall[]
      shown: readonly ShownRow[]
      setup?: (ids: CloseIds, ledger: CloseLedgerWriter) => void
      answers: ToolAnswer[]
      ledger?: CloseLedger
    }
  | undefined

// Stands where the agent phase will: the chapter's turns, the shown rows, all of them read.
async function* scriptedPhase(
  phase: PhaseContext,
): AsyncGenerator<PhaseEmittedEvent, PhaseResult, GroupOutcome | undefined> {
  const run = pending
  if (run === undefined) throw new Error('no scripted calls')
  const f = run.fixture
  const ids = closeIdsOf(phase.intermediates)
  ids.showTurns(chapterEntryIds(f))
  for (const { id, name } of run.shown) ids.show(id, name)
  const ledger = seedCloseLedger(phase.intermediates)
  run.ledger = ledger
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id))
  run.setup?.(ids, writer)
  const readSet = createReadSet()
  readSet.add(run.shown.map(({ id }) => ({ table: 'entities' as const, id })))
  const ctx: DispatchContext = {
    db: phase.db,
    branchId: phase.branchId,
    endEntryId: endEntryId(f),
    task: 'identity',
    part: 1,
    ids,
    readFields: {},
    survivorOf: (table, id) => writer.survivorOf(table, id),
    phase,
    chapterEntryIds: chapterEntryIds(f),
    readSet,
    ledger: writer,
  }
  for (const [index, { toolName, input }] of run.calls.entries()) {
    const tool = IDENTITY_TOOLS[toolName]
    if (tool === undefined) throw new Error(`no identity tool ${toolName}`)
    run.answers.push(
      yield* dispatchToolCall({ toolCallId: `call_${index + 1}`, toolName, input }, tool, ctx),
    )
  }
  return { status: 'completed' }
}

/** Runs `calls` through dispatchToolCall in one close-like run, `shown` shown and read in order. */
async function dispatchScripted(
  f: CloseFixture,
  calls: readonly ScriptedCall[],
  opts: {
    shown: readonly ShownRow[]
    setup?: (ids: CloseIds, ledger: CloseLedgerWriter) => void
  },
): Promise<DispatchRun> {
  if (getPipelineSafe(SCRIPTED_KIND) === undefined)
    definePipeline({
      kind: SCRIPTED_KIND,
      phases: [{ name: 'agent', run: scriptedPhase }],
      affordance: 'invisible',
      gateBehavior: 'hard-gate',
      concurrencyPolicy: {},
    })
  const run: NonNullable<typeof pending> = {
    fixture: f,
    calls,
    shown: opts.shown,
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
    if (run.ledger === undefined) throw new Error('the scripted phase never ran')
    return { result, answers: run.answers, calls: run.ledger.calls }
  } finally {
    pending = undefined
  }
}

afterEach(() => {
  resetAllStores()
})

// ---- update_character and update_faction ----

describe('update_character and update_faction: the tools', () => {
  it('replay as sent, every field but id optional, with no bound on a list', () => {
    assertReplaySafe(updateCharacterTool.schema, [
      { id: 'c1', turns: ['t1'], why: 'She says so.' },
      {
        id: 'c1',
        traits: terms('trait', 30),
        drives: [],
        voice: '',
        description: 'A courier.',
        turns: ['t1', 't2'],
        why: 'She says so.',
      },
    ])
    assertReplaySafe(updateFactionTool.schema, [
      { id: 'f1', turns: ['t1'], why: 'They say so.' },
      {
        id: 'f1',
        agenda: terms('aim', 30),
        standing: '',
        description: 'They hold the road.',
        turns: ['t3'],
        why: 'They say so.',
      },
    ])
  })

  it("take one id each, of their own kind, under canon's names", () => {
    expect(updateCharacterTool).toMatchObject({
      kind: 'write',
      name: 'update_character',
      ids: { id: { shape: 'single', prefixes: ['char_'] } },
    })
    expect(updateFactionTool).toMatchObject({
      kind: 'write',
      name: 'update_faction',
      ids: { id: { shape: 'single', prefixes: ['fact_'] } },
    })
  })
})

describe('update_character and update_faction', () => {
  let f: CloseFixture

  beforeEach(async () => {
    f = await openCloseFixture()
    await seedCast(f)
  })

  it("lands each call as one updateEntity, as chapter_close under the run's action on E", async () => {
    const { result, answers, calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: {
            id: 'c1',
            traits: terms('trait', 8),
            drives: terms('drive', 6),
            voice: 'hoarse from the rain',
            description: 'A courier, soaked through.',
            ...cite(),
          },
        },
        {
          toolName: 'update_faction',
          input: {
            id: 'f1',
            agenda: terms('aim', 4),
            standing: 'master of the road',
            description: 'They tax the ferry and the road.',
            ...cite(),
          },
        },
      ],
      { shown: CAST },
    )

    expect(answers.map(({ output }) => output)).toEqual([{ result: 'ok' }, { result: 'ok' }])
    expect(calls[0]).toEqual({
      task: 'identity',
      part: 1,
      tool: 'update_character',
      rows: [{ table: 'entities', id: WREN, name: 'Wren' }],
      why: 'The rain and the crossing show it.',
      turns: [endEntryId(f)],
      result: 'ok',
      values: {
        'state.traits': terms('trait', 8).join(', '),
        'state.drives': terms('drive', 6).join(', '),
        'state.voice': 'hoarse from the rain',
        description: 'A courier, soaked through.',
      },
    })
    expect(calls[1]).toMatchObject({
      tool: 'update_faction',
      result: 'ok',
      values: {
        'state.agenda': terms('aim', 4).join(', '),
        'state.standing': 'master of the road',
        description: 'They tax the ferry and the road.',
      },
    })
    const wren = await storedEntity(f, WREN)
    expect(wren.description).toBe('A courier, soaked through.')
    expect(wren.state).toMatchObject({
      traits: terms('trait', 8),
      drives: terms('drive', 6),
      voice: 'hoarse from the rain',
    })
    expect((await storedEntity(f, SYNDICATE)).state).toEqual({
      standing: 'master of the road',
      agenda: terms('aim', 4),
    })
    const written = await runDeltas(f, result.actionId)
    expect(written.map(({ targetId }) => targetId)).toEqual([WREN, SYNDICATE])
    for (const delta of written)
      expect(delta).toMatchObject({
        targetTable: 'entities',
        source: 'chapter_close',
        actionId: result.actionId,
        entryId: endEntryId(f),
      })
  })

  it('refuses a call whose every field is blank or empty, writing nothing', async () => {
    const { result, calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', traits: [], drives: ['  '], voice: '   ', description: '', ...cite() },
        },
        { toolName: 'update_faction', input: { id: 'f1', agenda: [], standing: ' ', ...cite() } },
      ],
      { shown: CAST },
    )

    for (const call of calls) {
      expect(call).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('blank or empty'),
      })
      expect(call).not.toHaveProperty('values')
    }
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, WREN)).state).toMatchObject(WREN_STATE)
  })

  it('drops an empty list and a blank text beside a real write', async () => {
    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', traits: ['patient', 'wary'], drives: [], voice: '', ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok', values: { 'state.traits': 'patient, wary' } })
    expect(Object.keys(calls[0]!.values ?? {})).toEqual(['state.traits'])
    expect((await storedEntity(f, WREN)).state).toMatchObject({
      traits: ['patient', 'wary'],
      drives: ['deliver the letter'],
      voice: 'soft',
    })
  })

  it('answers ok for a call that only restates, writing nothing and holding no values', async () => {
    const { result, answers, calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: {
            id: 'c1',
            traits: ['patient'],
            voice: 'soft ',
            description: 'A courier.',
            ...cite(),
          },
        },
      ],
      { shown: CAST },
    )

    expect(answers[0]!.output).toEqual({ result: 'ok' })
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('reads a description restated as sent as restated, though it is over the embedded bound', async () => {
    const long = 'The scribe copies every letter twice before it leaves. '.repeat(30).trim()
    await seedEntity(f, { id: SCRIBE, kind: 'character', name: 'The scribe', description: long })

    const { result, calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c3', description: long, ...cite() } }],
      { shown: [...CAST, { id: SCRIBE, name: 'The scribe' }] },
    )

    expect(long.length).toBeGreaterThan(1200)
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, SCRIBE)).description).toBe(long)
  })

  it('lands a 3,000-character voice cut to 2,000', async () => {
    const { calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c1', voice: 'v'.repeat(3000), ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, WREN)).state).toMatchObject({ voice: 'v'.repeat(2000) })
  })

  it('lands a 1,600-character description cut to 1,200, on a character and a faction', async () => {
    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', description: 'd'.repeat(1600), ...cite() },
        },
        {
          toolName: 'update_faction',
          input: { id: 'f1', description: 'e'.repeat(1600), ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls.map(({ result }) => result)).toEqual(['ok', 'ok'])
    expect((await storedEntity(f, WREN)).description).toBe('d'.repeat(1200))
    expect((await storedEntity(f, SYNDICATE)).description).toBe('e'.repeat(1200))
  })

  it("lands an 800-character standing cut to 500, a state text's bound", async () => {
    const { calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_faction', input: { id: 'f1', standing: 's'.repeat(800), ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, SYNDICATE)).state).toMatchObject({ standing: 's'.repeat(500) })
  })

  it("reads a resent user's value as restated, alone ok and beside a change out of values", async () => {
    await editEntity(f, WREN, 'user', { state: { voice: 'gravel' } })

    const { answers, calls } = await dispatchScripted(
      f,
      [
        { toolName: 'update_character', input: { id: 'c1', voice: 'gravel', ...cite() } },
        {
          toolName: 'update_character',
          input: { id: 'c1', voice: 'gravel', traits: ['patient', 'wary'], ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(answers.map(({ output }) => output)).toEqual([{ result: 'ok' }, { result: 'ok' }])
    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('values')
    expect(calls[1]).toMatchObject({ result: 'ok', values: { 'state.traits': 'patient, wary' } })
    expect(Object.keys(calls[1]!.values ?? {})).toEqual(['state.traits'])
    for (const call of calls) expect(call).not.toHaveProperty('skippedFields')
    expect((await storedEntity(f, WREN)).state).toMatchObject({
      voice: 'gravel',
      traits: ['patient', 'wary'],
    })
  })

  it('fills a blank description and a missing voice', async () => {
    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: {
            id: 'c2',
            description: 'The ferryman of Harrow.',
            voice: 'slow, and careful with it',
            ...cite(['t5', 't7']),
          },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    const tobin = await storedEntity(f, TOBIN)
    expect(tobin.description).toBe('The ferryman of Harrow.')
    expect(tobin.state).toMatchObject({
      voice: 'slow, and careful with it',
      traits: terms('trait', 12),
    })
  })

  it('lands the free fields beside a protected one, ok naming it, both in values', async () => {
    await editEntity(f, WREN, 'user', { state: { voice: 'gravel' } })

    const { answers, calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', voice: 'hoarse', traits: ['patient', 'wary'], ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      values: { 'state.voice': 'hoarse', 'state.traits': 'patient, wary' },
      skippedFields: [{ field: 'state.voice', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect(calls[0]).not.toHaveProperty('reason')
    expect(answers[0]!.output).toMatchObject({
      result: 'ok',
      notWritten: [{ field: 'state.voice', row: 'c1', reason: USER_EDITED_SINCE_PROSE }],
    })
    expect((await storedEntity(f, WREN)).state).toMatchObject({
      voice: 'gravel',
      traits: ['patient', 'wary'],
    })
  })

  it('skips a call whose every field is protected, writing nothing', async () => {
    await editEntity(f, WREN, 'user', { description: 'Mine.', state: { voice: 'gravel' } })

    const { result, calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', description: 'A courier, soaked.', voice: 'hoarse', ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'skipped',
      reason: USER_EDITED_SINCE_PROSE,
      values: { description: 'A courier, soaked.', 'state.voice': 'hoarse' },
    })
    expect(calls[0]).not.toHaveProperty('skippedFields')
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it("lets a user's edit of traits shield traits alone, not voice", async () => {
    await editEntity(f, WREN, 'user', { state: { traits: ['stubborn'] } })

    const { calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c1', voice: 'hoarse', ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok', values: { 'state.voice': 'hoarse' } })
    expect(calls[0]).not.toHaveProperty('skippedFields')
    expect((await storedEntity(f, WREN)).state).toMatchObject({
      voice: 'hoarse',
      traits: ['stubborn'],
    })
  })

  it('skips a standing a later turn wrote while the agenda lands', async () => {
    await editEntity(f, SYNDICATE, 'later-turn', {
      state: { standing: 'broken at the toll house' },
    })

    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_faction',
          input: {
            id: 'f1',
            standing: 'shaken',
            agenda: ['hold the road', 'read every letter'],
            ...cite(),
          },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.standing', reason: CLOSE_REASON.laterTurn }],
    })
    expect((await storedEntity(f, SYNDICATE)).state).toEqual({
      standing: 'broken at the toll house',
      agenda: ['hold the road', 'read every letter'],
    })
  })

  it('lands the description when voice is the only state field sent and it is protected', async () => {
    await editEntity(f, WREN, 'user', { state: { voice: 'gravel' } })

    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', voice: 'hoarse', description: 'A courier, soaked.', ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.voice', reason: USER_EDITED_SINCE_PROSE }],
    })
    const wren = await storedEntity(f, WREN)
    expect(wren.description).toBe('A courier, soaked.')
    expect(wren.state).toMatchObject({ voice: 'gravel' })
  })

  it('writes over a chapter_close delta past E, which is no later turn', async () => {
    await editEntity(f, WREN, 'earlier-close', { state: { voice: 'tired' } })

    const { calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c1', voice: 'hoarse', ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect(calls[0]).not.toHaveProperty('skippedFields')
    expect((await storedEntity(f, WREN)).state).toMatchObject({ voice: 'hoarse' })
  })

  it('refuses 9 traits, 7 drives or 5 agenda sent alone, writing nothing', async () => {
    const { result, calls } = await dispatchScripted(
      f,
      [
        { toolName: 'update_character', input: { id: 'c1', traits: terms('trait', 9), ...cite() } },
        { toolName: 'update_character', input: { id: 'c1', drives: terms('drive', 7), ...cite() } },
        { toolName: 'update_faction', input: { id: 'f1', agenda: terms('aim', 5), ...cite() } },
      ],
      { shown: CAST },
    )

    expect(calls.map(({ result: outcome, reason }) => [outcome, reason])).toEqual([
      ['rejected', softCapReason('traits', 8)],
      ['rejected', softCapReason('drives', 6)],
      ['rejected', softCapReason('agenda', 4)],
    ])
    for (const call of calls) expect(call).not.toHaveProperty('skippedFields')
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, WREN)).state).toMatchObject(WREN_STATE)
  })

  it('lands a sibling beside a list over its cap, ok naming the list and its reason', async () => {
    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', traits: terms('trait', 9), voice: 'hoarse', ...cite() },
        },
        {
          toolName: 'update_faction',
          input: { id: 'f1', agenda: terms('aim', 5), standing: 'master of the road', ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.traits', reason: softCapReason('traits', 8) }],
    })
    expect(Object.keys(calls[0]!.values ?? {}).sort()).toEqual(['state.traits', 'state.voice'])
    expect(calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.agenda', reason: softCapReason('agenda', 4) }],
    })
    expect((await storedEntity(f, WREN)).state).toMatchObject({
      traits: ['patient'],
      voice: 'hoarse',
    })
    expect((await storedEntity(f, SYNDICATE)).state).toEqual({
      standing: 'master of the road',
      agenda: ['tax the ferry'],
    })
  })

  it('dedupes a list before its cap: 9 entries with one repeat land as 8', async () => {
    const { calls } = await dispatchScripted(
      f,
      [
        {
          toolName: 'update_character',
          input: { id: 'c1', traits: [...terms('trait', 8), ' TRAIT 8 '], ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, WREN)).state).toMatchObject({ traits: terms('trait', 8) })
  })

  it('checks no cap on a list the guard removed', async () => {
    await editEntity(f, WREN, 'user', { state: { traits: ['stubborn'] } })

    const { calls } = await dispatchScripted(
      f,
      [
        { toolName: 'update_character', input: { id: 'c1', traits: terms('trait', 9), ...cite() } },
        {
          toolName: 'update_character',
          input: { id: 'c1', traits: terms('trait', 9), voice: 'hoarse', ...cite() },
        },
      ],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'skipped', reason: USER_EDITED_SINCE_PROSE })
    expect(calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.traits', reason: USER_EDITED_SINCE_PROSE }],
    })
  })

  it('on a row stored with 12 traits, lands a swap of 12 and 10, and refuses 13', async () => {
    const swap = [...terms('trait', 11), 'wary of the Syndicate']
    const grown = [...swap, 'drinks since noon']
    const shorter = swap.slice(0, 10)

    const { calls } = await dispatchScripted(
      f,
      [
        { toolName: 'update_character', input: { id: 'c2', traits: swap, ...cite() } },
        { toolName: 'update_character', input: { id: 'c2', traits: grown, ...cite() } },
        { toolName: 'update_character', input: { id: 'c2', traits: shorter, ...cite() } },
      ],
      { shown: CAST },
    )

    expect(calls.map(({ result, reason }) => [result, reason])).toEqual([
      ['ok', undefined],
      ['rejected', softCapReason('traits', 8)],
      ['ok', undefined],
    ])
    expect((await storedEntity(f, TOBIN)).state).toMatchObject({ traits: shorter })
  })

  it('refuses a gone row, naming the row a landed merge kept', async () => {
    const { result, answers, calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c3', voice: 'hoarse', ...cite() } }],
      {
        shown: [...CAST, { id: GONE, name: 'Old Wren' }],
        setup: (_ids, ledger) =>
          ledger.record({
            task: 'happenings',
            part: 0,
            tool: 'merge_characters',
            rows: [
              { table: 'entities', id: WREN, name: 'Wren' },
              { table: 'entities', id: GONE, name: 'Old Wren' },
            ],
            why: 'One courier.',
            turns: [],
            result: 'ok',
            values: { name: 'Wren' },
            survivor: { table: 'entities', id: WREN },
          }),
      },
    )

    expect(calls.at(-1)).toMatchObject({
      tool: 'update_character',
      rows: [{ table: 'entities', id: GONE, name: 'Old Wren' }],
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      values: { 'state.voice': 'hoarse' },
    })
    expect(answers[0]!.output).toEqual({
      result: 'rejected',
      reason: CLOSE_REASON.rowGone,
      note: 'The row was merged into c1; write to c1 instead.',
      survivor: 'c1',
    })
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })

  it('refuses a row of another kind', async () => {
    const tollId = 'char_00000000-0000-4000-8000-00000000b006'
    const bramId = 'fact_00000000-0000-4000-8000-00000000b007'
    await seedEntity(f, { id: tollId, kind: 'faction', name: 'The Toll' })
    await seedEntity(f, { id: bramId, kind: 'character', name: 'Bram' })

    const { result, calls } = await dispatchScripted(
      f,
      [
        { toolName: 'update_character', input: { id: 'c1', voice: 'gruff', ...cite() } },
        { toolName: 'update_faction', input: { id: 'f1', standing: 'feared', ...cite() } },
      ],
      {
        shown: [
          { id: tollId, name: 'The Toll' },
          { id: bramId, name: 'Bram' },
        ],
      },
    )

    expect(calls.map(({ result: outcome, reason }) => [outcome, reason])).toEqual([
      ['rejected', 'not-a-character'],
      ['rejected', 'not-a-faction'],
    ])
    expect(calls.map(({ values }) => values)).toEqual([
      { 'state.voice': 'gruff' },
      { 'state.standing': 'feared' },
    ])
    expect(await runDeltas(f, result.actionId)).toEqual([])
  })
})
