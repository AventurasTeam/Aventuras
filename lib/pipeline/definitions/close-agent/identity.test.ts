import { and, asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaAction } from '@/lib/actions/delta/apply-delta-action'
import { USER_EDITED_SINCE_PROSE, type DeltaSource, type GroupOutcome } from '@/lib/actions/types'
import { generateToolStep, type ResolveModelConfig, type ToolStepResult } from '@/lib/ai'
import {
  branches,
  deltas,
  emptyEntityState,
  entities,
  stories,
  storyEntries,
  type Entity,
  type EntityState,
  type NewEntity,
  type StoryMode,
} from '@/lib/db'
import { makeLogger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { createReadSet } from './common-checks'
import { dispatchToolCall, type DispatchContext, type ToolAnswer } from './dispatch'
import { softCapReason } from './fields'
import { IDENTITY_READ_FIELDS, identityTask } from './identity'
import { updateCharacterTool, updateFactionTool } from './identity-tools'
import { CloseIds } from './ids'
import { CloseLedgerWriter } from './ledger'
import { __setCloseAgentSlots, closeAgentSlots, NO_CLOSE_TASKS } from './slots'
import type { TaskPromptContext } from './task'
import { assertReplaySafe, type CloseTool } from './tool'
import { readTaskTurns, storyModeOf } from './turns'
import { CLOSE_REASON } from './verdict'
import { expectRan } from '../../__tests__/harness'
import { definePipeline } from '../../authoring/define'
import { getPipelineSafe } from '../../authoring/registry'
import { runPipeline } from '../../runtime/orchestrator'
import type { PhaseContext, PhaseEmittedEvent, PhaseResult, TxResult } from '../../types'
import { openCloseFixture, type CloseFixture } from '../__tests__/close-fixture'
import { closeAgentPhase } from '../chapter-close-agent'
import { closeIdsOf, closeLedgerOf, seedCloseLedger, setCloseRange } from '../close-intermediates'
import type { CloseLedger } from '../intermediates'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateToolStep: vi.fn(),
}))

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
  const writer = new CloseLedgerWriter(ledger, (id) => ids.nameOfId(id), phase.actionId)
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
      ['rejected', softCapReason('traits')],
      ['rejected', softCapReason('drives')],
      ['rejected', softCapReason('agenda')],
    ])
    for (const call of calls) expect(call).not.toHaveProperty('skippedFields')
    expect(await runDeltas(f, result.actionId)).toEqual([])
    expect((await storedEntity(f, WREN)).state).toMatchObject(WREN_STATE)
  })

  it.each([['[]'], ['[ ]'], ['""'], ['[""]']])(
    'reads traits sent as %j as not sent, the row unchanged',
    async (empty) => {
      const { result, calls } = await dispatchScripted(
        f,
        [{ toolName: 'update_character', input: { id: 'c1', traits: [empty], ...cite() } }],
        { shown: CAST },
      )

      expect(calls[0]).toMatchObject({
        result: 'rejected',
        reason: expect.stringContaining('blank or empty'),
      })
      expect(calls[0]).not.toHaveProperty('values')
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect((await storedEntity(f, WREN)).state).toMatchObject(WREN_STATE)
    },
  )

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
      skippedFields: [{ field: 'state.traits', reason: softCapReason('traits') }],
    })
    expect(Object.keys(calls[0]!.values ?? {}).sort()).toEqual(['state.traits', 'state.voice'])
    expect(calls[1]).toMatchObject({
      result: 'ok',
      skippedFields: [{ field: 'state.agenda', reason: softCapReason('agenda') }],
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

  it.each([
    ['quotes', '","'],
    ['escaped quotes', '\\",\\"'],
  ])(
    'refuses 12 traits joined into one entry with %s, on a row at its cap, saying how it read them',
    async (_, join) => {
      await editEntity(f, WREN, 'earlier-close', { state: { traits: terms('trait', 8) } })
      const joined = [terms('sailor', 12).join(join)]

      const { result, calls } = await dispatchScripted(
        f,
        [{ toolName: 'update_character', input: { id: 'c1', traits: joined, ...cite() } }],
        { shown: CAST },
      )

      expect(calls[0]).toMatchObject({ result: 'rejected' })
      expect(calls[0]!.reason).toContain(softCapReason('traits'))
      expect(calls[0]!.reason).toContain('read as 12 entries')
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect((await storedEntity(f, WREN)).state).toMatchObject({ traits: terms('trait', 8) })
    },
  )

  it('lands a list joined into one entry under its cap as the entries it holds', async () => {
    const { calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c1', traits: ['brave","wary'], ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({ result: 'ok' })
    expect((await storedEntity(f, WREN)).state).toMatchObject({ traits: ['brave', 'wary'] })
  })

  it.each([['user'], ['earlier-close']] as const)(
    'reads a resent list whose stored entry holds a line break as restated, after a %s edit',
    async (editor) => {
      const traits = ['patient', 'stubborn\nwary']
      await editEntity(f, WREN, editor, { state: { traits } })

      const { result, calls } = await dispatchScripted(
        f,
        [{ toolName: 'update_character', input: { id: 'c1', traits, ...cite() } }],
        { shown: CAST },
      )

      expect(calls[0]).toMatchObject({ result: 'ok' })
      expect(calls[0]).not.toHaveProperty('skippedFields')
      expect(await runDeltas(f, result.actionId)).toEqual([])
      expect((await storedEntity(f, WREN)).state).toMatchObject({ traits })
    },
  )

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

  it('lands a list that drops a stored duplicate, compacting a row over its cap', async () => {
    await editEntity(f, WREN, 'earlier-close', {
      state: { traits: [...terms('trait', 8), 'Trait 8'] },
    })

    const { result, calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c1', traits: terms('trait', 8), ...cite() } }],
      { shown: CAST },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      values: { 'state.traits': terms('trait', 8).join(', ') },
    })
    expect(await runDeltas(f, result.actionId)).toHaveLength(1)
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
      ['rejected', softCapReason('traits')],
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

  // Entities key on (branch_id, id): the fork's copy goes in first, where a read by id finds it.
  it("judges and writes the close's branch row, where a fork holds the same id", async () => {
    const forkId = 'br_close_fork'
    await f.ctx.db.insert(branches).values({
      id: forkId,
      storyId: f.storyId,
      parentBranchId: f.branchId,
      name: 'fork',
      createdAt: 2,
    })
    const forkState = { ...emptyEntityState('character'), traits: ['wary', 'sly'], voice: 'dry' }
    await putEntityRow(f, {
      id: SCRIBE,
      kind: 'character',
      name: 'The fork scribe',
      state: forkState,
      branchId: forkId,
    })
    await seedEntity(f, {
      id: SCRIBE,
      kind: 'character',
      name: 'The scribe',
      state: { traits: ['patient'] },
    })

    const { result, calls } = await dispatchScripted(
      f,
      [{ toolName: 'update_character', input: { id: 'c3', traits: ['wary', 'sly'], ...cite() } }],
      { shown: [...CAST, { id: SCRIBE, name: 'The scribe' }] },
    )

    expect(calls[0]).toMatchObject({
      result: 'ok',
      rows: [{ table: 'entities', id: SCRIBE, name: 'The scribe' }],
      values: { 'state.traits': 'wary, sly' },
    })
    expect((await runDeltas(f, result.actionId)).map(({ targetId }) => targetId)).toEqual([SCRIBE])
    expect((await storedEntity(f, SCRIBE)).state).toMatchObject({ traits: ['wary', 'sly'] })
    const [fork] = await f.ctx.db
      .select()
      .from(entities)
      .where(and(eq(entities.branchId, forkId), eq(entities.id, SCRIBE)))
    expect(fork).toMatchObject({ name: 'The fork scribe', state: forkState })
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

// Real prefix_<uuid> ids: CloseIds hands a handle only to a substitutable id.
const START_ROWS = {
  bess: 'char_00000000-0000-4000-8000-00000000b001',
  pew: 'char_00000000-0000-4000-8000-00000000b002',
  pip: 'char_00000000-0000-4000-8000-00000000b003',
  ghost: 'char_00000000-0000-4000-8000-00000000b004',
  landing: 'loc_00000000-0000-4000-8000-00000000b005',
  hand: 'fact_00000000-0000-4000-8000-00000000b006',
  ledger: 'fact_00000000-0000-4000-8000-00000000b007',
  syndicate: 'fact_00000000-0000-4000-8000-00000000b008',
  tollmen: 'fact_00000000-0000-4000-8000-00000000b009',
  greyLower: 'fact_00000000-0000-4000-8000-00000000b00a',
  quietUpper: 'fact_00000000-0000-4000-8000-00000000b00b',
  quietTwin: 'fact_00000000-0000-4000-8000-00000000b00c',
} as const

type EntityRowSeed = {
  id: string
  kind: 'character' | 'location' | 'faction'
  name: string
  status?: 'active' | 'retired'
  description?: string | null
  state?: EntityState | null
  keywords?: string[]
  /** The fixture's branch unless given. */
  branchId?: string
}

// Written as a hand-edited or imported row is, with no delta: a start reads rows, not history.
async function putEntityRow(fx: CloseFixture, row: EntityRowSeed): Promise<void> {
  await fx.ctx.db.insert(entities).values({
    id: row.id,
    branchId: row.branchId ?? fx.branchId,
    kind: row.kind,
    name: row.name,
    description: row.description ?? null,
    status: row.status ?? 'active',
    retiredReason: row.status === 'retired' ? 'Left the story.' : null,
    injectionMode: 'auto',
    state: row.state ?? null,
    keywords: row.keywords ?? [],
    createdAt: 1,
    updatedAt: 1,
  })
}

async function setSceneOf(
  fx: CloseFixture,
  entryId: string,
  sceneIds: readonly string[],
): Promise<void> {
  const where = and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, entryId))
  const [row] = await fx.ctx.db
    .select({ metadata: storyEntries.metadata })
    .from(storyEntries)
    .where(where)
  if (!row?.metadata) throw new Error(`setSceneOf: entry ${entryId} has no metadata`)
  await fx.ctx.db
    .update(storyEntries)
    .set({ metadata: { ...row.metadata, sceneEntities: [...sceneIds] } })
    .where(where)
}

async function setStoryMode(fx: CloseFixture, mode: StoryMode): Promise<void> {
  const [story] = await fx.ctx.db
    .select({ definition: stories.definition })
    .from(stories)
    .where(eq(stories.id, fx.storyId))
  if (!story?.definition) throw new Error('setStoryMode: the fixture story has no definition')
  await fx.ctx.db
    .update(stories)
    .set({ definition: { ...story.definition, mode } })
    .where(eq(stories.id, fx.storyId))
}

// As the agent phase does before any task: every chapter entry a turn, t1 the first.
function idsWithTurns(fx: CloseFixture): CloseIds {
  const ids = new CloseIds()
  ids.showTurns(fx.entries.map((entry) => entry.id))
  return ids
}

// A start makes no call, so the config is only carried.
const START_CONFIG: ResolveModelConfig = { providers: [], profiles: [], assignments: {} }

function promptContextFor(
  fx: CloseFixture,
  ids: CloseIds,
  chapterEntryIds: readonly string[] = fx.entries.map((entry) => entry.id),
): TaskPromptContext {
  const actionId = 'act_identity_start'
  return {
    db: fx.ctx.db,
    branchId: fx.branchId,
    endEntryId: fx.entries.at(-1)!.id,
    task: 'identity',
    part: 1,
    ids,
    readFields: IDENTITY_READ_FIELDS,
    survivorOf: () => undefined,
    phase: {
      actionId,
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger(actionId),
      db: fx.ctx.db,
      runInTransaction: fx.ctx.runInTransaction,
      storyId: fx.storyId,
      branchId: fx.branchId,
    },
    chapterEntryIds,
    config: START_CONFIG,
  }
}

describe('readTaskTurns', () => {
  it("reads the task's entries in position order, each under its turn handle", async () => {
    const fx = await openCloseFixture()
    const ids = idsWithTurns(fx)
    // A part's ids, given out of order: the read orders them by position.
    const part = [fx.entries[3]!.id, fx.entries[1]!.id]

    const { entries, closeTurns } = await readTaskTurns(promptContextFor(fx, ids, part))

    expect(entries.map((entry) => entry.id)).toEqual([fx.entries[1]!.id, fx.entries[3]!.id])
    expect(closeTurns).toEqual([
      {
        handle: 't2',
        kind: 'user_action',
        content: 'I tie the mare outside the inn and shake the rain from my hood.',
      },
      {
        handle: 't4',
        kind: 'user_action',
        content: 'I ask the innkeeper whether the ferry still runs at night.',
      },
    ])
  })

  // Ids and insertion follow position in the fixture, so one entry moves past the other.
  it('orders by position, not by id', async () => {
    const fx = await openCloseFixture()
    const ids = idsWithTurns(fx)
    const [moved, kept] = [fx.entries[1]!.id, fx.entries[3]!.id]
    await fx.ctx.db
      .update(storyEntries)
      .set({ position: 100 })
      .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, moved)))

    const { entries } = await readTaskTurns(promptContextFor(fx, ids, [moved, kept]))

    expect(entries.map((entry) => entry.id)).toEqual([kept, moved])
  })

  it('reads nothing for a task with no entries', async () => {
    const fx = await openCloseFixture()

    expect(await readTaskTurns(promptContextFor(fx, idsWithTurns(fx), []))).toEqual({
      entries: [],
      closeTurns: [],
      proseTokens: 0,
    })
  })
})

describe('storyModeOf', () => {
  it('reads the mode of the story behind the branch', async () => {
    const fx = await openCloseFixture()
    const ctx = promptContextFor(fx, idsWithTurns(fx))

    expect(await storyModeOf(ctx)).toBe('creative')
    await setStoryMode(fx, 'adventure')
    expect(await storyModeOf(ctx)).toBe('adventure')
  })

  it('throws for a story with no definition', async () => {
    const fx = await openCloseFixture()
    await fx.ctx.db.update(stories).set({ definition: null }).where(eq(stories.id, fx.storyId))

    await expect(storyModeOf(promptContextFor(fx, idsWithTurns(fx)))).rejects.toThrow('no mode')
  })
})

describe('identityTask', () => {
  async function startOf(fx: CloseFixture, ids = idsWithTurns(fx)) {
    const ctx = promptContextFor(fx, ids)
    return { ctx, ids, start: await identityTask.start(ctx) }
  }

  it("lists canon's tools in order and reads a character's and a faction's slow fields", () => {
    expect(identityTask.task).toBe('identity')
    expect(identityTask.tools.map((tool) => tool.name)).toEqual([
      'search_world',
      'read_row',
      'update_character',
      'update_faction',
    ])
    expect(IDENTITY_READ_FIELDS).toEqual({
      character: ['state.traits', 'state.drives', 'state.voice', 'description'],
      faction: ['state.agenda', 'state.standing', 'description'],
    })
    expect(identityTask.readFields).toBe(IDENTITY_READ_FIELDS)
  })

  it('starts from the scene characters of any status, and from no scene id without a character row', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await putEntityRow(fx, {
      id: START_ROWS.pew,
      kind: 'character',
      name: 'Pew',
      status: 'retired',
    })
    await putEntityRow(fx, { id: START_ROWS.landing, kind: 'location', name: 'The landing' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip, START_ROWS.ghost])
    await setSceneOf(fx, fx.entries[5]!.id, [START_ROWS.pew, START_ROWS.landing, START_ROWS.pip])

    const { ctx, ids, start } = await startOf(fx)

    expect(start?.show.characters.map((c) => [c.id, c.name, c.status])).toEqual([
      ['c1', 'Pew', 'retired'],
      ['c2', 'Pip', 'active'],
    ])
    expect(ids.handleOf(START_ROWS.ghost)).toBeUndefined()
    expect(ids.handleOf(START_ROWS.landing)).toBeUndefined()
    const { system, user } = identityTask.render(start!, { ...ctx, writesSoFar: '' })
    expect(`${system}${user}`).not.toContain(START_ROWS.ghost)
    expect(user).not.toContain('The landing')
  })

  it("shows each row's writable fields as stored, a missing text as empty", async () => {
    const fx = await openCloseFixture()
    // Over its cap and with a repeat: a start shows the list as it stands.
    const traits = [
      'brave',
      'brave',
      'loyal',
      'stubborn',
      'quick',
      'proud',
      'kind',
      'sly',
      'shy',
      'loud',
    ]
    await putEntityRow(fx, {
      id: START_ROWS.bess,
      kind: 'character',
      name: 'Bess',
      state: { ...emptyEntityState('character'), traits },
    })
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      description: 'A stable boy at the inn.',
      state: {
        ...emptyEntityState('character'),
        traits: ['curious'],
        drives: ['find the ferryman'],
        voice: 'Quick and bright.',
        faction_id: START_ROWS.hand,
      },
    })
    await putEntityRow(fx, {
      id: START_ROWS.hand,
      kind: 'faction',
      name: 'The Quiet Hand',
      description: 'Smugglers who keep to the dark.',
      state: {
        standing: 'Feared along the river.',
        agenda: ['tax the ferry', 'read every letter'],
      },
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip, START_ROWS.bess])

    const { ctx, start } = await startOf(fx)

    expect(start?.show.characters).toEqual([
      { id: 'c1', name: 'Bess', status: 'active', description: '', traits, drives: [], voice: '' },
      {
        id: 'c2',
        name: 'Pip',
        status: 'active',
        description: 'A stable boy at the inn.',
        traits: ['curious'],
        drives: ['find the ferryman'],
        voice: 'Quick and bright.',
      },
    ])
    expect(start?.show.factions).toEqual([
      {
        id: 'f1',
        name: 'The Quiet Hand',
        status: 'active',
        description: 'Smugglers who keep to the dark.',
        standing: 'Feared along the river.',
        agenda: ['tax the ferry', 'read every letter'],
      },
    ])
    const { user } = identityTask.render(start!, { ...ctx, writesSoFar: '' })
    expect(user).toContain('The caps are 8 traits, 6 drives and 4 agenda items.')
    expect(user).toContain('- traits: ["curious"]\n- drives: ["find the ferryman"]')
    expect(user).toContain('- standing: "Feared along the river."')
  })

  // As read_row answers: ids are the prompt's short ids. Each shown row takes its handle first.
  it("shows a full id in a row's name or text as its handle, a shown row's as it is shown", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, {
      id: START_ROWS.bess,
      kind: 'character',
      name: 'Bess',
      description: `Owes ${START_ROWS.pip} a favour and fears ${START_ROWS.hand}.`,
      state: {
        ...emptyEntityState('character'),
        traits: [`sworn to ${START_ROWS.ledger}`],
        drives: [`find ${START_ROWS.ghost}`],
        voice: `Like ${START_ROWS.pip}.`,
        faction_id: START_ROWS.ledger,
      },
    })
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: `Pip of ${START_ROWS.hand}`,
      state: { ...emptyEntityState('character'), faction_id: START_ROWS.hand },
    })
    await putEntityRow(fx, {
      id: START_ROWS.ledger,
      kind: 'faction',
      name: 'The Grey Ledger',
      state: { standing: `Rivals of ${START_ROWS.hand}.`, agenda: [`ruin ${START_ROWS.bess}`] },
    })
    await putEntityRow(fx, {
      id: START_ROWS.hand,
      kind: 'faction',
      name: `The Hand that hunts ${START_ROWS.bess}`,
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip, START_ROWS.bess])

    const { ctx, start } = await startOf(fx)

    expect(start?.show.characters[0]).toEqual({
      id: 'c1',
      name: 'Bess',
      status: 'active',
      description: 'Owes c2 a favour and fears f2.',
      traits: ['sworn to f1'],
      drives: [expect.stringMatching(/^find c\d+$/)],
      voice: 'Like c2.',
    })
    expect(start?.show.characters[1]?.name).toBe('Pip of f2')
    expect(start?.show.factions).toEqual([
      {
        id: 'f1',
        name: 'The Grey Ledger',
        status: 'active',
        description: '',
        standing: 'Rivals of f2.',
        agenda: ['ruin c1'],
      },
      {
        id: 'f2',
        name: 'The Hand that hunts c1',
        status: 'active',
        description: '',
        standing: '',
        agenda: [],
      },
    ])
    const { system, user } = identityTask.render(start!, { ...ctx, writesSoFar: '' })
    for (const id of Object.values(START_ROWS)) expect(`${system}${user}`).not.toContain(id)
  })

  it("brings a scene character's faction by membership, and no faction the chapter doesn't touch", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      state: { ...emptyEntityState('character'), faction_id: START_ROWS.hand },
    })
    await putEntityRow(fx, { id: START_ROWS.hand, kind: 'faction', name: 'The Quiet Hand' })
    await putEntityRow(fx, {
      id: START_ROWS.ledger,
      kind: 'faction',
      name: 'The Grey Ledger',
      keywords: ['Ledger'],
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip])

    const { start } = await startOf(fx)

    expect(start?.show.factions.map((faction) => faction.name)).toEqual(['The Quiet Hand'])
  })

  // Code units, not the host locale: "Pip" sorts before "bess". Inserted out of order.
  it('orders scene characters by name in code units, then by id', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: START_ROWS.bess, kind: 'character', name: 'bess' })
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await putEntityRow(fx, { id: START_ROWS.ghost, kind: 'character', name: 'Ann' })
    await putEntityRow(fx, { id: START_ROWS.pew, kind: 'character', name: 'Pip' })
    await setSceneOf(fx, fx.entries[2]!.id, [
      START_ROWS.bess,
      START_ROWS.pip,
      START_ROWS.ghost,
      START_ROWS.pew,
    ])

    const { ids, start } = await startOf(fx)

    expect(start?.show.characters.map((character) => [character.id, character.name])).toEqual([
      ['c1', 'Ann'],
      ['c2', 'Pip'],
      ['c3', 'Pip'],
      ['c4', 'bess'],
    ])
    expect(ids.handleOf(START_ROWS.pew)).toBe('c2')
    expect(ids.handleOf(START_ROWS.pip)).toBe('c3')
  })

  // Code units, not the host locale: "The…" sorts before "the…". Inserted out of order.
  it('orders factions by name in code units, then by id', async () => {
    const fx = await openCloseFixture()
    const member = (id: string, name: string, factionId: string) =>
      putEntityRow(fx, {
        id,
        kind: 'character',
        name,
        state: { ...emptyEntityState('character'), faction_id: factionId },
      })
    await member(START_ROWS.bess, 'Bess', START_ROWS.greyLower)
    await member(START_ROWS.pew, 'Pew', START_ROWS.quietTwin)
    await member(START_ROWS.pip, 'Pip', START_ROWS.quietUpper)
    await putEntityRow(fx, { id: START_ROWS.greyLower, kind: 'faction', name: 'the grey ledger' })
    await putEntityRow(fx, { id: START_ROWS.quietTwin, kind: 'faction', name: 'The Quiet Hand' })
    await putEntityRow(fx, { id: START_ROWS.quietUpper, kind: 'faction', name: 'The Quiet Hand' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.bess, START_ROWS.pew, START_ROWS.pip])

    const { ids, start } = await startOf(fx)

    expect(start?.show.factions.map((faction) => [faction.id, faction.name])).toEqual([
      ['f1', 'The Quiet Hand'],
      ['f2', 'The Quiet Hand'],
      ['f3', 'the grey ledger'],
    ])
    expect(ids.handleOf(START_ROWS.quietUpper)).toBe('f1')
    expect(ids.handleOf(START_ROWS.quietTwin)).toBe('f2')
  })

  // Forks share entry and entity ids under (branch_id, id): every read keeps to the close's branch.
  it("reads only the close's branch, where a fork holds the same ids", async () => {
    const fx = await openCloseFixture({ turns: 9 })
    const forkId = 'br_close_fork'
    await fx.ctx.db.insert(branches).values({
      id: forkId,
      storyId: fx.storyId,
      parentBranchId: fx.branchId,
      name: 'fork',
      createdAt: 2,
    })
    const copied = fx.entries[2]!.id
    const [row] = await fx.ctx.db
      .select()
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, fx.branchId), eq(storyEntries.id, copied)))
    await fx.ctx.db.insert(storyEntries).values({
      ...row!,
      branchId: forkId,
      content: 'Only the fork remembers this.',
      metadata: { ...row!.metadata!, sceneEntities: [START_ROWS.bess] },
    })
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      description: 'The stable boy on the main branch.',
    })
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      description: 'The stable boy on the fork.',
      branchId: forkId,
    })
    await putEntityRow(fx, {
      id: START_ROWS.bess,
      kind: 'character',
      name: 'Bess',
      branchId: forkId,
    })
    // The main branch's prose names "the Syndicate"; only the fork holds the faction.
    await putEntityRow(fx, {
      id: START_ROWS.syndicate,
      kind: 'faction',
      name: 'The Syndicate',
      branchId: forkId,
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip])

    const { start } = await startOf(fx)

    expect(start?.show.closeTurns).toHaveLength(fx.entries.length)
    expect(start?.show.closeTurns.map((turn) => turn.content).join('\n')).not.toContain(
      'Only the fork',
    )
    expect(start?.show.characters.map((c) => [c.name, c.description])).toEqual([
      ['Pip', 'The stable boy on the main branch.'],
    ])
    expect(start?.show.factions).toEqual([])
  })

  // Nine turns: the seventh and ninth replies name "the Syndicate".
  it('brings a faction the turns name by its name, with no character in the scene', async () => {
    const fx = await openCloseFixture({ turns: 9 })
    await putEntityRow(fx, { id: START_ROWS.syndicate, kind: 'faction', name: 'The Syndicate' })
    await putEntityRow(fx, {
      id: START_ROWS.ledger,
      kind: 'faction',
      name: 'The Grey Ledger',
      keywords: ['Ledger'],
    })

    const { start } = await startOf(fx)

    expect(start?.show.characters).toEqual([])
    expect(start?.show.factions).toEqual([
      {
        id: 'f1',
        name: 'The Syndicate',
        status: 'active',
        description: '',
        standing: '',
        agenda: [],
      },
    ])
  })

  // matchTerms lowercases only the prose: a keyword stored "Syndicate" must be normalized first.
  it('brings a faction by a keyword alone, whatever case the keyword is stored in', async () => {
    const fx = await openCloseFixture({ turns: 9 })
    await putEntityRow(fx, {
      id: START_ROWS.tollmen,
      kind: 'faction',
      name: 'The Tollmen',
      keywords: ['Syndicate'],
    })

    const { start } = await startOf(fx)

    expect(start?.show.factions.map((faction) => faction.name)).toEqual(['The Tollmen'])
  })

  it('seeds every shown row as read, and no other', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: START_ROWS.bess, kind: 'character', name: 'Bess' })
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      state: { ...emptyEntityState('character'), faction_id: START_ROWS.hand },
    })
    await putEntityRow(fx, { id: START_ROWS.hand, kind: 'faction', name: 'The Quiet Hand' })
    await putEntityRow(fx, { id: START_ROWS.ledger, kind: 'faction', name: 'The Grey Ledger' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip, START_ROWS.bess])

    const { start } = await startOf(fx)

    expect(start?.seeds).toEqual([
      { table: 'entities', id: START_ROWS.bess },
      { table: 'entities', id: START_ROWS.pip },
      { table: 'entities', id: START_ROWS.hand },
    ])
  })

  it('returns null, showing nothing, when the chapter touches no character and no faction', async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await putEntityRow(fx, {
      id: START_ROWS.ledger,
      kind: 'faction',
      name: 'The Grey Ledger',
      keywords: ['Ledger'],
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.landing, START_ROWS.ghost])

    const { ids, start } = await startOf(fx)

    expect(start).toBeNull()
    expect(ids.handleOf(START_ROWS.pip)).toBeUndefined()
    expect(ids.handleOf(START_ROWS.ledger)).toBeUndefined()
  })

  it("names every shown row's id and name in the user half, then the writes so far", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, {
      id: START_ROWS.pip,
      kind: 'character',
      name: 'Pip',
      state: { ...emptyEntityState('character'), faction_id: START_ROWS.hand },
    })
    await putEntityRow(fx, {
      id: START_ROWS.pew,
      kind: 'character',
      name: 'Pew',
      status: 'retired',
      state: { ...emptyEntityState('character'), faction_id: START_ROWS.ledger },
    })
    await putEntityRow(fx, { id: START_ROWS.hand, kind: 'faction', name: 'The Quiet Hand' })
    await putEntityRow(fx, {
      id: START_ROWS.ledger,
      kind: 'faction',
      name: 'The Grey Ledger',
      status: 'retired',
    })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip, START_ROWS.pew])
    const { ctx, start } = await startOf(fx)
    const writes = '- update_thread Find the heir (th1): description'

    const { system, user } = identityTask.render(start!, { ...ctx, writesSoFar: writes })

    expect(user).toContain('## c1: Pew (retired)\n')
    expect(user).toContain('## c2: Pip\n')
    expect(user).toContain('## f1: The Grey Ledger (retired)\n')
    expect(user).toContain('## f2: The Quiet Hand\n')
    expect(
      user.endsWith(`# Writes so far\nWhat this close has written, in earlier tasks:\n${writes}`),
    ).toBe(true)
    expect(system).not.toContain('# Characters')
    expect(system).not.toContain('The Quiet Hand')
  })

  it("puts the task's turns and the story mode's rule in the system half", async () => {
    const fx = await openCloseFixture()
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip])

    const creative = await startOf(fx)
    const creativePrompt = identityTask.render(creative.start!, {
      ...creative.ctx,
      writesSoFar: '',
    })
    expect(creativePrompt.system).toContain('Each is a direction or prose')
    expect(creativePrompt.system).not.toContain('Each is what the lead does, says or attempts')
    expect(creativePrompt.system).toContain(
      '## t3 (narration)\nThe inn is warm and loud with drovers.',
    )
    expect(creativePrompt.user).not.toContain('# The turns')

    await setStoryMode(fx, 'adventure')
    const adventure = await startOf(fx)
    const { system } = identityTask.render(adventure.start!, { ...adventure.ctx, writesSoFar: '' })
    expect(system).toContain('Each is what the lead does, says or attempts')
    expect(system).not.toContain('Each is a direction or prose')
  })
})

// A reply with no tool call: the task ends after one step.
function noCallStep(): ToolStepResult {
  return {
    status: 'ok',
    step: {
      calls: [],
      invalidCalls: [],
      responseMessages: [
        { role: 'assistant', content: [{ type: 'text', text: 'Nothing to change.' }] },
      ],
      text: 'Nothing to change.',
      finishReason: 'stop',
      usage: {
        inputTokens: 100,
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokens: 5,
        outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
        totalTokens: 105,
      },
    },
    recoverable: [],
  }
}

// The opening through the third reply (positions 1-7): one part.
function closePhaseFor(fx: CloseFixture): PhaseContext {
  const actionId = 'act_identity_close'
  const intermediates: Record<string, unknown> = {}
  setCloseRange(intermediates, {
    chapterId: 'chap_identity_close',
    startEntryId: fx.entries[0]!.id,
    endEntryId: fx.replyIds[2]!,
  })
  return {
    actionId,
    abortSignal: new AbortController().signal,
    intermediates,
    log: makeLogger(actionId),
    db: fx.ctx.db,
    runInTransaction: fx.ctx.runInTransaction,
    storyId: fx.storyId,
    branchId: fx.branchId,
  }
}

// No step writes here, so no group outcome is ever owed back.
async function drainAgent(
  ctx: PhaseContext,
): Promise<{ events: PhaseEmittedEvent[]; result: PhaseResult }> {
  const gen = closeAgentPhase(ctx)
  const events: PhaseEmittedEvent[] = []
  for (;;) {
    const next = await gen.next(undefined)
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const taskStartsIn = (events: readonly PhaseEmittedEvent[]): PhaseEmittedEvent[] =>
  events.filter((event) => event.type === 'close_task_start')

// C6: both tasks start, a task with nothing to show included, in a one-part chapter of 7.
const PART_ONE_STARTS = [
  { type: 'close_task_start', task: 'identity', part: 1, index: 3, total: 7 },
  { type: 'close_task_start', task: 'threads', part: 1, index: 4, total: 7 },
]

describe('Identity in the production close', () => {
  let fx: CloseFixture

  beforeEach(async () => {
    vi.mocked(generateToolStep).mockReset()
    vi.mocked(generateToolStep).mockResolvedValue(noCallStep())
    __setCloseAgentSlots(undefined)
    fx = await openCloseFixture()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetAllStores()
  })

  it("sends canon's Identity tools, starting 3 of 7, on a chapter with a scene character", async () => {
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip])

    const { events, result } = await drainAgent(closePhaseFor(fx))

    expect(result).toEqual({ status: 'completed' })
    expect(taskStartsIn(events)).toEqual(PART_ONE_STARTS)
    expect(generateToolStep).toHaveBeenCalledTimes(1)
    const [, request] = vi.mocked(generateToolStep).mock.calls[0]!
    expect(Object.keys(request.tools)).toEqual([
      'search_world',
      'read_row',
      'update_character',
      'update_faction',
    ])
    expect(request.prompt.user).toContain('## c1: Pip\n')
  })

  it('makes no step call and no failure when neither task has anything to start from', async () => {
    const ctx = closePhaseFor(fx)

    const { events, result } = await drainAgent(ctx)

    expect(result).toEqual({ status: 'completed' })
    expect(taskStartsIn(events)).toEqual(PART_ONE_STARTS)
    expect(generateToolStep).not.toHaveBeenCalled()
    expect(closeLedgerOf(ctx.intermediates)).toEqual({ calls: [], stopped: [], noToolCalls: true })
  })

  // Positive control: the first case's fixture makes a step on the production slots.
  it('runs no task on the empty slots a close test that is not about the tasks sets', async () => {
    await putEntityRow(fx, { id: START_ROWS.pip, kind: 'character', name: 'Pip' })
    await setSceneOf(fx, fx.entries[2]!.id, [START_ROWS.pip])
    __setCloseAgentSlots(NO_CLOSE_TASKS)

    expect(closeAgentSlots()).toBe(NO_CLOSE_TASKS)
    const { events, result } = await drainAgent(closePhaseFor(fx))

    expect(result).toEqual({ status: 'completed' })
    expect(events).toEqual([])
    expect(generateToolStep).not.toHaveBeenCalled()
  })
})
