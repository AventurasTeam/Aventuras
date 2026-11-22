import type { AssistantModelMessage, ToolCallPart } from 'ai'
import { and, asc, desc, eq, isNotNull, lte } from 'drizzle-orm'
import { afterEach, beforeEach, expect, vi, type Mock } from 'vitest'

import { startCloseChain } from '@/lib/actions/chapters/close-chain'
import { startManualClose } from '@/lib/actions/chapters/start-manual-close'
import {
  applyDeltaAction,
  applyDeltaActionGroupWithOutcomes,
} from '@/lib/actions/delta/apply-delta-action'
import { shownCounts } from '@/lib/actions/story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '@/lib/actions/story-entries/operational'
import type { GroupOutcome, PipelineAction } from '@/lib/actions/types'
import type {
  CallRetryError,
  GenerateStructuredResult,
  generateStructured,
  generateToolStep,
  ToolStep,
  ToolStepCall,
  ToolStepResult,
} from '@/lib/ai'
import { CHAPTER_CLOSE_KIND, cutChapterParts } from '@/lib/chapters'
import {
  chapters,
  characterRelationships,
  deltas,
  entities,
  happeningAwareness,
  happeningInvolvements,
  happenings,
  lore,
  pipelineRuns,
  storyEntries,
  threads,
  type Delta,
  type EntityState,
  type PipelineRun,
} from '@/lib/db'
import {
  configureDeltaActionPort,
  pipelineEventBus,
  type ChainEnd,
  type TxResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, realDeltaActionPort, resetSingletons } from './harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '../definitions/__tests__/close-fixture'
import { chapterPartSummarySchema } from '../definitions/chapter-metadata-schema'
import { __setCloseAgentSlots, type CloseAgentSlots } from '../definitions/close-agent/slots'

// A real close over the close fixture through the orchestrator, and its re-run. Each suite mocks
// `@/lib/ai` and hands its mocks in, as chapter-delete-fixture's hooks take theirs.

/** The model calls a close makes, faked by the suite's own `vi.mock('@/lib/ai')`. */
export type CloseMocks = {
  readonly generateStructured: Mock<typeof generateStructured>
  readonly generateToolStep: Mock<typeof generateToolStep>
}

/** The file-level hooks every suite on this harness shares. */
export function installCloseHarnessHooks(mocks: CloseMocks): void {
  beforeEach(() => {
    resetSingletons()
    mocks.generateStructured.mockReset()
    mocks.generateStructured.mockResolvedValue(metadataReplyResult())
    mocks.generateToolStep.mockReset()
  })

  afterEach(() => {
    __setCloseAgentSlots(undefined)
    resetSingletons()
    vi.restoreAllMocks()
  })
}

// The third of six replies (position 7): turns lie on both sides of the close.
export const END_REPLY = 2

export const CHARACTER_ID = 'char_5b0d2c1e-7f3a-4e8b-9c6d-2a1f0e9b8c7d'

// t3 is position 3, before E: a group anchored on the cited turn would survive the rollback to E.
export const STAND_IN_INPUT = {
  id: 'c1',
  description: 'The Harrow ferryman, who poled Wren across the river at night for a courier price.',
  title: 'The Harrow ferry',
  body: 'Old Tobin runs the ferry at Harrow when he chooses to, and the Syndicate taxes every crossing.',
  turns: ['t3'],
  why: 'Tobin is the ferryman Wren finds at the landing.',
}

/** A step held while a test acts on the run in flight. */
export type StepHold = {
  /** Resolves once the held step is sent. */
  readonly reached: Promise<void>
  /** Answers the held step as scripted. */
  readonly release: () => void
  readonly released: Promise<void>
  readonly arrive: () => void
}

export function stepHold(): StepHold {
  let arrive!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => {
    arrive = resolve
  })
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { reached, released, release, arrive }
}

/** A step the scripted model answers. */
export type ScriptedStep = {
  calls: readonly Omit<ToolStepCall, 'toolCallId'>[]
  /** Answered once released; an abort answers it `aborted` at once. */
  held?: StepHold
  /** The step fails after the call's retries, as `generateToolStep` reports one. */
  failed?: Exclude<CallRetryError, { tier: 'reply-cut-off' }>
}

/** The stand-in task's one call: a lore row and Tobin's description, one group on E. */
export const STAND_IN_STEP: ScriptedStep = {
  calls: [{ toolName: 'stand_in_write', input: STAND_IN_INPUT }],
}

const USAGE: ToolStep['usage'] = {
  inputTokens: 1_000,
  inputTokenDetails: { noCacheTokens: 1_000, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokens: 50,
  outputTokenDetails: { textTokens: 50, reasoningTokens: 0 },
  totalTokens: 1_050,
}

const DONE = 'Nothing more to write.'

function stepResult(step: ScriptedStep, n: number): ToolStepResult {
  const calls: ToolStepCall[] = step.calls.map((call, i) => ({
    ...call,
    toolCallId: `call_${n}_${i + 1}`,
  }))
  const message: AssistantModelMessage = {
    role: 'assistant',
    content:
      calls.length === 0
        ? [{ type: 'text', text: DONE }]
        : calls.map((call): ToolCallPart => ({ type: 'tool-call', ...call })),
  }
  return {
    status: 'ok',
    step: {
      calls,
      invalidCalls: [],
      responseMessages: [message],
      text: calls.length === 0 ? DONE : '',
      finishReason: calls.length === 0 ? 'stop' : 'tool-calls',
      usage: USAGE,
    },
    recoverable: [],
  }
}

async function abortedWhileHeld(hold: StepHold, signal: AbortSignal): Promise<boolean> {
  hold.arrive()
  if (signal.aborted) return true
  return Promise.race([
    hold.released.then(() => false),
    new Promise<boolean>((resolve) => {
      signal.addEventListener('abort', () => resolve(true), { once: true })
    }),
  ])
}

// Every step past the script replies with no tool call, which ends the task.
export function script(mock: Mock<typeof generateToolStep>, steps: readonly ScriptedStep[]): void {
  let sent = 0
  mock.mockImplementation(async (_target, _request, _config, signal) => {
    sent += 1
    const n = sent
    const step: ScriptedStep = steps[n - 1] ?? { calls: [] }
    if (step.held !== undefined && (await abortedWhileHeld(step.held, signal)))
      return { status: 'aborted', recoverable: [] }
    if (step.failed !== undefined) return { status: 'failed', error: step.failed, recoverable: [] }
    return stepResult(step, n)
  })
}

const WORLD_TABLES = [
  'chapters',
  'entities',
  'lore',
  'threads',
  'happenings',
  'happening_involvements',
  'happening_awareness',
  'character_relationships',
] as const
type WorldTable = (typeof WORLD_TABLES)[number]

const isWorldTable = (table: string): table is WorldTable =>
  (WORLD_TABLES as readonly string[]).includes(table)

/** Every table a close tool writes, keyed by delta `target_table`, and the entries a chapter stamps. */
export type WorldState = {
  rows: Record<WorldTable, readonly { id: string }[]>
  stamped: readonly { id: string; chapterId: string | null }[]
}

export async function worldState(fx: CloseFixture): Promise<WorldState> {
  const { db } = fx.ctx
  const b = fx.branchId
  return {
    rows: {
      chapters: await db
        .select()
        .from(chapters)
        .where(eq(chapters.branchId, b))
        .orderBy(asc(chapters.id)),
      entities: await db
        .select()
        .from(entities)
        .where(eq(entities.branchId, b))
        .orderBy(asc(entities.id)),
      lore: await db.select().from(lore).where(eq(lore.branchId, b)).orderBy(asc(lore.id)),
      threads: await db
        .select()
        .from(threads)
        .where(eq(threads.branchId, b))
        .orderBy(asc(threads.id)),
      happenings: await db
        .select()
        .from(happenings)
        .where(eq(happenings.branchId, b))
        .orderBy(asc(happenings.id)),
      happening_involvements: await db
        .select()
        .from(happeningInvolvements)
        .where(eq(happeningInvolvements.branchId, b))
        .orderBy(asc(happeningInvolvements.id)),
      happening_awareness: await db
        .select()
        .from(happeningAwareness)
        .where(eq(happeningAwareness.branchId, b))
        .orderBy(asc(happeningAwareness.id)),
      character_relationships: await db
        .select()
        .from(characterRelationships)
        .where(eq(characterRelationships.branchId, b))
        .orderBy(asc(characterRelationships.id)),
    },
    stamped: await db
      .select({ id: storyEntries.id, chapterId: storyEntries.chapterId })
      .from(storyEntries)
      .where(and(eq(storyEntries.branchId, b), isNotNull(storyEntries.chapterId)))
      .orderBy(asc(storyEntries.position)),
  }
}

export async function branchLog(fx: CloseFixture): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, fx.branchId))
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

export async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, fx.branchId), eq(deltas.actionId, actionId)))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

export type SeedEntity = {
  id: string
  kind: 'character' | 'location' | 'item' | 'faction'
  name: string
  description: string
  status: 'active' | 'retired'
  state?: EntityState
}

export const TOBIN: SeedEntity = {
  id: CHARACTER_ID,
  kind: 'character',
  name: 'Tobin',
  description: 'The ferryman at Harrow.',
  status: 'active',
}

// A pass's create anchored on the first reply: a rollback to E or past it spares it.
export async function seedEntity(fx: CloseFixture, seed: SeedEntity): Promise<void> {
  const result = await applyDeltaAction(
    {
      action: {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: {
          entry: {
            ...seed,
            branchId: fx.branchId,
            injectionMode: 'auto',
            createdAt: 1_767_225_700_000,
            updatedAt: 1_767_225_700_000,
          },
        },
      },
      actionId: `act_close_seed_${seed.name.toLowerCase()}`,
      branchId: fx.branchId,
      entryId: fx.replyIds[0],
    },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`round trip: seed refused: ${result.reason}`)
}

export type ToolGroup = { kinds: readonly PipelineAction['kind'][]; landed: boolean }

const landedAny = (outcome: GroupOutcome | undefined): boolean =>
  outcome?.status === 'ok' && outcome.outcomes.some((one) => one.status === 'landed')

export function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`round trip: ${what}`)
  return value
}

/** What `openHarness` runs: the close's slots and script, and the rows its tools need. */
export type CloseCase = {
  slots: () => CloseAgentSlots
  /** Rows the case's tools need, written before the state the arms compare against. */
  seed?: (fx: CloseFixture) => Promise<void>
  steps: readonly ScriptedStep[]
  /** The re-run's script, when it isn't the close's. */
  rerunSteps?: readonly ScriptedStep[]
  merge: boolean
  /** lore-mgmt's window for this case, so the fixture's range cuts into parts. */
  partWindow?: number
  /** Kinds whose landed group the abort arm fires on; absent: any landed non-metadata group. */
  abortOn?: readonly PipelineAction['kind'][]
}

// A code step's group reads to the bus as a tool's, so a case with one names the kinds to act on.
const firesAbort = (c: Pick<CloseCase, 'abortOn'>, group: ToolGroup): boolean =>
  c.abortOn === undefined || group.kinds.some((kind) => c.abortOn?.includes(kind) === true)

export type CloseHarness = {
  readonly fx: CloseFixture
  /** E: the case's close ends on the third reply of six. */
  readonly endEntryId: string
  /** The state before the close ran. */
  readonly before: WorldState
  /** The branch's whole delta log before the close ran: other actions' deltas only. */
  readonly beforeLog: readonly Delta[]
  /** Runs the close to completion; a case must land at least one group past the metadata's. */
  close: () => Promise<void>
  /**
   * Starts the close and calls `act` once the first group its case's `abortOn` admits lands;
   * resolves with the run.
   */
  closeActingOnToolGroup: (act: () => void) => Promise<TxResult>
  /** Calls `act` once the next group the case's `abortOn` admits lands: a close's or a re-run's. */
  onNextToolGroup: (act: () => void) => void
  /** The group `act` ran on, if it ran. */
  actedOn: () => ToolGroup | undefined
  /** The close's action, once it started. */
  actionId: () => string
  /** The state and the close's own log as the close completed. */
  closed: () => { state: WorldState; log: Delta[] }
  /** Rolls the branch back to `targetId`, which goes with every entry after it. */
  rollBack: (targetId: string) => Promise<void>
  /** The entry a rollback took the branch back to, if one ran. */
  rolledBackTo: () => string | undefined
  /**
   * Re-runs `chapterId` on the case's re-run script: `pendingRerun`, then the close chain. Resolves
   * with the chain's end; throws when the start is refused.
   */
  rerun: (chapterId: string) => Promise<ChainEnd>
  /** The latest re-run's action, once its close reserved. */
  rerunActionId: () => string | undefined
}

export async function openHarness(c: CloseCase, mocks: CloseMocks): Promise<CloseHarness> {
  const fx = await openCloseFixture(
    c.partWindow === undefined ? undefined : { loreWindow: c.partWindow },
  )
  await seedEntity(fx, TOBIN)
  await c.seed?.(fx)
  if (c.partWindow !== undefined) {
    await expectCutBeforeEnd(fx, c.partWindow)
    answerPartCalls(mocks.generateStructured)
  }
  __setCloseAgentSlots(c.slots())
  script(mocks.generateToolStep, c.steps)
  // The bus hears every group the orchestrator dispatched, refused or not; the port has its outcome.
  let lastOutcome: GroupOutcome | undefined
  configureDeltaActionPort({
    ...realDeltaActionPort(),
    applyDeltaActionGroupWithOutcomes: async (actions, args, ctx) => {
      lastOutcome = await applyDeltaActionGroupWithOutcomes(actions, args, ctx)
      return lastOutcome
    },
  })
  const toolGroups: ToolGroup[] = []
  let onToolGroup: (() => void) | undefined
  let actedOn: ToolGroup | undefined
  // The metadata group is the one with the create.
  pipelineEventBus.subscribe('delta_group_emitted', (event) => {
    const group: ToolGroup = {
      kinds: event.actions.map((a) => a.kind),
      landed: landedAny(lastOutcome),
    }
    if (group.kinds.includes('createChapter')) return
    toolGroups.push(group)
    const act = onToolGroup
    if (act === undefined || !group.landed || !firesAbort(c, group)) return
    onToolGroup = undefined
    actedOn = group
    act()
  })
  let rerunning = false
  let rerunAction: string | undefined
  // A chained close's run_start comes from its own beginRun, as an origin's does.
  pipelineEventBus.subscribe('run_start', (event) => {
    if (rerunning && event.kind === CHAPTER_CLOSE_KIND) rerunAction = event.actionId
  })
  const endEntryId = fx.replyIds[END_REPLY]
  const before = await worldState(fx)
  const beforeLog = await branchLog(fx)
  let actionId: string | undefined
  let closed: { state: WorldState; log: Delta[] } | undefined
  let rolledBackTo: string | undefined
  const start = async (): Promise<TxResult> => {
    const tx = expectRan(await startManualClose(fx.branchId, endEntryId, fx.ctx))
    actionId = tx.actionId
    return tx
  }
  return {
    fx,
    endEntryId,
    before,
    beforeLog,
    close: async () => {
      const tx = await start()
      expect(tx).toMatchObject({ outcome: 'completed' })
      expect(
        toolGroups.some((group) => group.landed),
        'the case landed nothing',
      ).toBe(true)
      const log = await deltasOf(fx, tx.actionId)
      if (c.merge)
        expect(
          log.some((d) => d.op === 'delete'),
          'a merge case deletes the row it absorbs',
        ).toBe(true)
      // A table the snapshot misses would let a reversal leave rows behind unseen.
      const unlisted = new Set(
        log.map((d) => d.targetTable).filter((t) => t !== 'story_entries' && !isWorldTable(t)),
      )
      expect([...unlisted], 'close deltas on tables the snapshot misses').toEqual([])
      closed = { state: await worldState(fx), log }
    },
    closeActingOnToolGroup: (act) => {
      onToolGroup = act
      return start()
    },
    onNextToolGroup: (act) => {
      onToolGroup = act
    },
    actedOn: () => actedOn,
    actionId: () => defined(actionId, 'the close has not started'),
    closed: () => defined(closed, 'the close has not completed'),
    rollBack: async (targetId) => {
      const counts = await shownCounts(fx.branchId, targetId, fx.ctx)
      expect(
        await rollbackToEntry(fx.branchId, targetId, fx.ctx, { expectedCounts: counts }),
      ).toEqual({ status: 'ok', counts })
      rolledBackTo = targetId
    },
    rolledBackTo: () => rolledBackTo,
    rerun: async (chapterId) => {
      script(mocks.generateToolStep, c.rerunSteps ?? c.steps)
      rerunAction = undefined
      rerunning = true
      generationStore.setPendingRerun(fx.branchId, { chapterId })
      try {
        const end = await startCloseChain(fx.branchId, fx.ctx)
        if ('outcome' in end) {
          // No run reserved, so no chain end clears the record.
          generationStore.clearPendingRerun(fx.branchId)
          throw new Error(`close harness: the re-run was refused: ${end.blockedBy}`)
        }
        return end
      } finally {
        rerunning = false
      }
    },
    rerunActionId: () => rerunAction,
  }
}

/** The one chapter the harness's close made. */
export function closedChapterId(h: CloseHarness): string {
  const [chapter, ...more] = h.closed().state.rows.chapters
  expect(more, 'the close made one chapter').toEqual([])
  return defined(chapter, 'the close made no chapter').id
}

export async function rerunMarker(h: CloseHarness): Promise<PipelineRun | undefined> {
  const actionId = defined(h.rerunActionId(), 'the re-run never reserved')
  const [row] = await h.fx.ctx.db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.actionId, actionId))
  return row
}

/** The kinds of every group dispatched from now on, refused or not. */
export function recordGroups(): PipelineAction['kind'][][] {
  const seen: PipelineAction['kind'][][] = []
  pipelineEventBus.subscribe('delta_group_emitted', (event) => {
    seen.push(event.actions.map((a) => a.kind))
  })
  return seen
}

const PART_SUMMARY: GenerateStructuredResult<{ summary: string }> = {
  status: 'ok',
  value: { summary: 'Wren reaches Harrow and finds the night ferry.' },
  recoverable: [],
}

// A part call answers the part shape; the merge, and a one-part close, the metadata.
function answerPartCalls(mock: Mock<typeof generateStructured>): void {
  mock.mockImplementation(
    async (_target, _prompt, schema) =>
      ((schema as unknown) === chapterPartSummarySchema
        ? PART_SUMMARY
        : metadataReplyResult()) as never,
  )
}

// The case's window comes from the fixture's prose; the cut must agree with the counts it stored.
async function expectCutBeforeEnd(fx: CloseFixture, window: number): Promise<void> {
  const endIndex = fx.entries.findIndex((entry) => entry.id === fx.replyIds[END_REPLY])
  const stored = await fx.ctx.db
    .select({ id: storyEntries.id, kind: storyEntries.kind, tokens: storyEntries.contentTokens })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, fx.branchId),
        lte(storyEntries.position, fx.entries[endIndex]!.position),
      ),
    )
    .orderBy(asc(storyEntries.position))
  const cuts = cutChapterParts(
    stored.map(({ id, kind, tokens }) => ({ id, kind, tokens: tokens ?? 0 })),
    window,
  )
  // E's turn (the player's turn before it) goes with E: a part never ends on a player's turn.
  expect(fx.entries[endIndex - 1]!.kind).toBe('user_action')
  expect(
    cuts.map(({ part, startEntryId, endEntryId }) => [part, startEntryId, endEntryId]),
    "the case window cuts the chapter just before E's turn",
  ).toEqual([
    [1, fx.entries[0]!.id, fx.entries[endIndex - 2]!.id],
    [2, fx.entries[endIndex - 1]!.id, fx.entries[endIndex]!.id],
  ])
}
