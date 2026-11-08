import { and, asc, eq, gt, gte, lte, ne, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyDeltaActionGroupWithOutcomes } from '@/lib/actions/delta/apply-delta-action'
import { isContentEditDelta } from '@/lib/actions/story-entries/classifier-facts'
import type { ActionOutcome, GroupOutcome, PipelineAction } from '@/lib/actions/types'
import { generateStructured, type GenerateStructuredResult } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { chapters, deltas, storyEntries, type Delta } from '@/lib/db'
import {
  appSettingsStore,
  chaptersStore,
  currentStoryStore,
  entriesStore,
  generationStore,
  hydrateAppSettings,
  resetAllStores,
  type AppSettingsSnapshot,
  type RunState,
} from '@/lib/stores'

import {
  METADATA_REPLY,
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from './__tests__/close-fixture'
import { CHAPTER_CLOSE_RESOLVES, ensureChapterClosePipelineRegistered } from './chapter-close'
import { closeAgentPhase } from './chapter-close-agent'
import { closeBoundaryPhase } from './chapter-close-boundary'
import { closeMetadataPhase } from './chapter-close-metadata'
import { readCloseRangeEntries } from './chapter-close-metadata-call'
import { closeReportPhase } from './chapter-close-report'
import { closeAgentSlots, PRODUCTION_CLOSE_SLOTS } from './close-agent/slots'
import { closeLedgerOf } from './close-intermediates'
import { readClassifierStatus } from './memory-chain'
import { expectRan, realDeltaActionPort } from '../__tests__/harness'
import { __resetRegistry, getPipeline } from '../authoring/registry'
import { configureDeltaActionPort } from '../runtime/action-port'
import { __resetBus, pipelineEventBus } from '../runtime/event-bus'
import { runPipeline } from '../runtime/orchestrator'
import type { PipelineEvent, TxResult } from '../types'

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: vi.fn(),
}))

let f: CloseFixture

beforeEach(async () => {
  vi.resetAllMocks()
  __resetRegistry()
  __resetBus()
  ensureChapterClosePipelineRegistered()
  vi.mocked(generateStructured).mockResolvedValue(metadataReplyResult())
  f = await openCloseFixture()
})

afterEach(() => {
  resetAllStores()
})

const positionOf = (id: string): number => f.entries.find((e) => e.id === id)!.position

async function runClose(endEntryId: string): Promise<TxResult> {
  generationStore.setPendingClose(f.branchId, { endEntryId })
  return expectRan(
    await runPipeline(CHAPTER_CLOSE_KIND, {
      storyId: f.storyId,
      branchId: f.branchId,
      db: f.ctx.db,
      runInTransaction: f.ctx.runInTransaction,
    }),
  )
}

function recordEvents(): PipelineEvent[] {
  const events: PipelineEvent[] = []
  pipelineEventBus.subscribeAll((event) => {
    events.push(event)
  })
  return events
}

// The row a close's action targets, so a test can read which rows each write event named.
function targetOf(action: PipelineAction): string {
  switch (action.kind) {
    case 'createChapter':
      return action.payload.entry.id
    case 'stampEntryChapter':
    case 'updateChapter':
      return action.payload.id
    default:
      return action.kind
  }
}

type Write = {
  type: 'delta_group_emitted' | 'delta_emitted'
  entryId: string | null | undefined
  actions: [string, string, string][]
}

// Each write event of the run, in order: its anchor and each action's kind, target and source.
function recordWrites(): Write[] {
  const writes: Write[] = []
  const named = (a: PipelineAction): [string, string, string] => [a.kind, targetOf(a), a.source]
  pipelineEventBus.subscribeAll((event) => {
    if (event.type === 'delta_group_emitted')
      writes.push({ type: event.type, entryId: event.entryId, actions: event.actions.map(named) })
    else if (event.type === 'delta_emitted')
      writes.push({ type: event.type, entryId: event.entryId, actions: [named(event.action)] })
  })
  return writes
}

function liveClose(): RunState | undefined {
  return [...generationStore.getTxState().runs.values()].find((r) => r.kind === CHAPTER_CLOSE_KIND)
}

async function lastLogPosition(): Promise<number> {
  const [row] = await f.ctx.db
    .select({ lp: sql<number>`COALESCE(MAX(${deltas.logPosition}), 0)` })
    .from(deltas)
    .where(eq(deltas.branchId, f.branchId))
  return row?.lp ?? 0
}

async function deltasAfter(logPosition: number): Promise<Delta[]> {
  return (await f.ctx.db
    .select()
    .from(deltas)
    .where(and(eq(deltas.branchId, f.branchId), gt(deltas.logPosition, logPosition)))
    .orderBy(asc(deltas.logPosition))) as Delta[]
}

// Independent of the phase's own sum: straight from the column, by position.
async function sqlTokenSum(fromPosition: number, throughPosition: number): Promise<number> {
  const [row] = await f.ctx.db
    .select({ total: sql<number>`COALESCE(SUM(${storyEntries.contentTokens}), 0)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, f.branchId),
        ne(storyEntries.kind, 'system'),
        gte(storyEntries.position, fromPosition),
        lte(storyEntries.position, throughPosition),
      ),
    )
  return row?.total ?? 0
}

function chapterRows() {
  return f.ctx.db
    .select()
    .from(chapters)
    .where(eq(chapters.branchId, f.branchId))
    .orderBy(asc(chapters.sequenceNumber))
}

function entryRows() {
  return f.ctx.db
    .select({
      id: storyEntries.id,
      position: storyEntries.position,
      chapterId: storyEntries.chapterId,
      contentTokens: storyEntries.contentTokens,
    })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, f.branchId))
    .orderBy(asc(storyEntries.position))
}

async function branchState() {
  return {
    entries: (await entryRows()).map(({ id, chapterId }) => ({ id, chapterId })),
    chapters: (await chapterRows()).map(({ id }) => id),
    deltas: (await deltasAfter(0)).map(({ id }) => id),
  }
}

async function rewire(edit: (settings: AppSettingsSnapshot) => AppSettingsSnapshot) {
  const next = edit(appSettingsStore.getAppSettings())
  expect(await hydrateAppSettings(async () => next)).toEqual({ status: 'ok' })
}

// Profile timeouts are seconds. The fixture keeps the two targets on separate profiles.
function withTimeouts(seconds: { 'lore-mgmt': number; classifier: number }) {
  return (s: AppSettingsSnapshot): AppSettingsSnapshot => {
    const byProfile = new Map<string, number>([
      [s.assignments['lore-mgmt'], seconds['lore-mgmt']],
      [s.assignments.classifier, seconds.classifier],
    ])
    return {
      ...s,
      profiles: s.profiles.map((p) => ({ ...p, timeout: byProfile.get(p.id) ?? p.timeout })),
    }
  }
}

function abortsOnSignal(): void {
  vi.mocked(generateStructured).mockImplementation(
    (_target, _prompt, _schema, _config, signal) =>
      new Promise<GenerateStructuredResult<never>>((resolve) => {
        signal.addEventListener('abort', () => resolve({ status: 'aborted', recoverable: [] }))
      }),
  )
}

describe('the chapter-close declaration', () => {
  it('pins C2: four phases in order, lore-mgmt on all but report, and every field', () => {
    const pipeline = getPipeline(CHAPTER_CLOSE_KIND)
    const lore = [{ target: 'lore-mgmt' }]

    expect(CHAPTER_CLOSE_RESOLVES).toEqual(lore)
    expect(pipeline.kind).toBe('chapter-close')
    expect(pipeline.phases).toEqual([
      { name: 'boundary', run: closeBoundaryPhase, resolves: lore },
      { name: 'metadata', run: closeMetadataPhase, resolves: lore },
      { name: 'agent', run: closeAgentPhase, resolves: lore },
      { name: 'report', run: closeReportPhase },
    ])
    expect(pipeline.phases[3]).not.toHaveProperty('resolves')
    expect(pipeline.affordance).toBe('pill-and-banner')
    expect(pipeline.gateBehavior).toBe('hard-gate')
    expect(pipeline.interruptible).toBe('close')
    expect(pipeline.concurrencyPolicy).toEqual({
      blockedBy: ['per-turn', 'periodic-classifier', 'chapter-close', 'translation-retry'],
    })
    expect(pipeline.chainsTo).toBeUndefined()
    expect(pipeline.onPreflightFailure).toBeUndefined()
    expect(pipeline.onPhaseException).toBeUndefined()
    expect(pipeline.onInterrupt).toBeUndefined()
  })

  it('registers once, however often it is ensured', () => {
    const first = getPipeline(CHAPTER_CLOSE_KIND)

    expect(() => ensureChapterClosePipelineRegistered()).not.toThrow()
    expect(getPipeline(CHAPTER_CLOSE_KIND)).toBe(first)
  })
})

describe('openCloseFixture', () => {
  it('opens a counted branch, a create per entry past the opening, watermark at the tail', async () => {
    expect(f.entries.map((e) => e.kind)).toEqual([
      'opening',
      ...Array.from({ length: 6 }, () => ['user_action', 'ai_reply']).flat(),
    ])
    expect(f.entries.map((e) => e.position)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1))
    expect(f.replyIds).toEqual(f.entries.filter((e) => e.kind === 'ai_reply').map((e) => e.id))
    for (const row of await entryRows())
      expect(row.contentTokens, `entry ${row.position}`).toBeGreaterThan(0)

    const creates = await f.ctx.db
      .select({ targetId: deltas.targetId, actionId: deltas.actionId, entryId: deltas.entryId })
      .from(deltas)
      .where(and(eq(deltas.targetTable, 'story_entries'), eq(deltas.op, 'create')))
    expect(creates.map((d) => d.targetId).sort()).toEqual(
      f.entries
        .slice(1)
        .map((e) => e.id)
        .sort(),
    )
    expect(new Set(creates.map((d) => d.actionId)).size).toBe(6)
    for (const create of creates) {
      const kind = f.entries.find((e) => e.id === create.targetId)!.kind
      expect(create.entryId, create.targetId).toBe(kind === 'ai_reply' ? create.targetId : null)
    }
    expect(await readClassifierStatus(f.branchId, f.ctx)).toMatchObject({
      state: 'idle',
      processedThrough: 13,
    })
    expect(currentStoryStore.getCurrentStory()).toMatchObject({
      storyId: f.storyId,
      branchId: f.branchId,
    })
    expect(appSettingsStore.getAppSettings().assignments['lore-mgmt']).not.toBe(
      appSettingsStore.getAppSettings().assignments.classifier,
    )
  })
})

describe('a committed close', () => {
  it('runs boundary, metadata, agent and report, in that order', async () => {
    const events = recordEvents()

    await runClose(f.replyIds[2]!)

    expect(events.flatMap((e) => (e.type === 'phase_start' ? [e.name] : []))).toEqual([
      'boundary',
      'metadata',
      'agent',
      'report',
    ])
  })

  // Criterion 3.
  it('logs one create, a stamp per entry through the end and one update, under one action', async () => {
    const end = f.replyIds[2]!
    const before = await lastLogPosition()

    const run = await runClose(end)

    expect(run.outcome).toBe('completed')
    const [row] = await chapterRows()
    const through = f.entries.filter((e) => e.position <= positionOf(end))
    expect(through).toHaveLength(7)
    const written = await deltasAfter(before)
    expect(written.map((d) => [d.targetTable, d.op, d.targetId])).toEqual([
      ['chapters', 'create', row!.id],
      ...through.map((e) => ['story_entries', 'update', e.id]),
      ['chapters', 'update', row!.id],
    ])
    for (const delta of written) {
      expect(delta.actionId, delta.id).toBe(run.actionId)
      expect(delta.source, delta.id).toBe('chapter_close')
      expect(delta.entryId, delta.id).toBe(end)
      expect(isContentEditDelta(delta), delta.id).toBe(false)
    }
    expect(written.slice(1, -1).map((d) => d.undoPayload)).toEqual(
      through.map(() => ({ chapterId: null })),
    )
  })

  // C1: one group, the create first, then a stamp per entry in position order; the report after it.
  it('writes the create and every stamp as one group on the end entry, the report alone after it', async () => {
    const end = f.replyIds[2]!
    const writes = recordWrites()

    const run = await runClose(end)

    expect(run.outcome).toBe('completed')
    const [row] = await chapterRows()
    const through = f.entries.filter((e) => e.position <= positionOf(end))
    expect(writes).toEqual([
      {
        type: 'delta_group_emitted',
        entryId: end,
        actions: [
          ['createChapter', row!.id, 'chapter_close'],
          ...through.map((e): [string, string, string] => [
            'stampEntryChapter',
            e.id,
            'chapter_close',
          ]),
        ],
      },
      {
        type: 'delta_emitted',
        entryId: end,
        actions: [['updateChapter', row!.id, 'chapter_close']],
      },
    ])
  })

  // Criterion 4.
  it('writes the row over the range and leaves every entry past the end unstamped', async () => {
    const end = f.replyIds[2]!
    const startedAt = Date.now()

    const run = await runClose(end)

    const [row] = await chapterRows()
    expect(row).toMatchObject({
      sequenceNumber: 1,
      startEntryId: f.entries[0]!.id,
      endEntryId: end,
      title: METADATA_REPLY.title,
      summary: METADATA_REPLY.summary,
      theme: METADATA_REPLY.theme,
      keywords: METADATA_REPLY.keywords,
      closeReport: {
        version: 1,
        actionId: run.actionId,
        calls: [],
        stopped: [],
        noToolCalls: true,
      },
    })
    expect(row!.closedAt).toBeGreaterThanOrEqual(startedAt)
    expect(row!.closedAt).toBeLessThanOrEqual(Date.now())
    expect(row!.createdAt).toBe(row!.closedAt)
    for (const entry of await entryRows())
      expect(entry.chapterId, `entry ${entry.position}`).toBe(
        entry.position <= positionOf(end) ? row!.id : null,
      )
  })

  // Criterion 4: the rows past the end count, so a sum that ran past it would show.
  it('sums token_count over the range and stops at the end entry', async () => {
    const end = f.replyIds[2]!

    await runClose(end)

    const [row] = await chapterRows()
    const pastEnd = (await entryRows()).filter((e) => e.position > positionOf(end))
    expect(pastEnd.length).toBeGreaterThan(0)
    for (const entry of pastEnd)
      expect(entry.contentTokens, `entry ${entry.position}`).toBeGreaterThan(0)
    expect(row!.tokenCount).toBeGreaterThan(0)
    expect(row!.tokenCount).toBe(await sqlTokenSum(1, positionOf(end)))
  })

  it("numbers a second close 2 and starts it right after the first one's end", async () => {
    const first = f.replyIds[2]!
    const second = f.replyIds[5]!

    await runClose(first)
    await runClose(second)

    const [, row] = await chapterRows()
    const start = f.entries.find((e) => e.position === positionOf(first) + 1)!
    expect(row).toMatchObject({ sequenceNumber: 2, startEntryId: start.id, endEntryId: second })
    expect(row!.tokenCount).toBe(await sqlTokenSum(start.position, positionOf(second)))
  })

  // C2: a phase after the stamps reads the range by its ids, as one before them does.
  it("reads each closed chapter's range back as the rows it stamped", async () => {
    await runClose(f.replyIds[2]!)
    await runClose(f.replyIds[5]!)

    const rows = await entryRows()
    const closed = await chapterRows()
    expect(closed).toHaveLength(2)
    for (const chapter of closed) {
      const stamped = rows.filter((e) => e.chapterId === chapter.id).map((e) => e.id)
      expect(stamped.length, chapter.id).toBeGreaterThan(0)
      const read = await readCloseRangeEntries(f.ctx.db, f.branchId, {
        chapterId: chapter.id,
        startEntryId: chapter.startEntryId,
        endEntryId: chapter.endEntryId,
      })
      expect(
        read.map((e) => e.id),
        chapter.id,
      ).toEqual(stamped)
    }
  })
})

// Criterion 5.
describe('a cancelled close', () => {
  // The group lands whole; a Cancel is heard at the next phase boundary and reverses all of it.
  it('reverses the create and every stamp when Cancel lands after the group commits', async () => {
    const before = await branchState()
    const groups: string[][] = []
    const singles: string[] = []
    // The bus hears the group after it is dispatched; the reversal that follows emits no event.
    pipelineEventBus.subscribe('delta_group_emitted', (event) => {
      groups.push(event.actions.map((a) => a.kind))
      liveClose()?.abortController.abort()
    })
    pipelineEventBus.subscribe('delta_emitted', (event) => {
      singles.push(event.action.kind)
    })

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('aborted')
    expect(groups).toEqual([
      ['createChapter', ...Array.from({ length: 7 }, () => 'stampEntryChapter')],
    ])
    expect(singles).toEqual([])
    expect(await branchState()).toEqual(before)
    expect(entriesStore.getEntries().size).toBe(f.entries.length)
    expect([...entriesStore.getEntries().values()].every((e) => e.chapterId === null)).toBe(true)
    expect(chaptersStore.getChapters().size).toBe(0)
    expect(generationStore.getTxState().deferred.get(f.branchId)).toEqual({ close: true })
  })

  it('writes nothing when cancelled during the metadata call', async () => {
    let callSawCancel = false
    vi.mocked(generateStructured).mockImplementation(async (_t, _p, _s, _c, signal) => {
      liveClose()!.abortController.abort()
      callSawCancel = signal.aborted
      return { status: 'aborted', recoverable: [] }
    })
    const before = await branchState()
    const emitted: unknown[] = []
    pipelineEventBus.subscribe('delta_emitted', (event) => {
      emitted.push(event)
    })
    pipelineEventBus.subscribe('delta_group_emitted', (event) => {
      emitted.push(event)
    })

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('aborted')
    expect(emitted).toEqual([])
    expect(callSawCancel).toBe(true)
    expect(await branchState()).toEqual(before)
    expect(generationStore.getTxState().deferred.get(f.branchId)).toEqual({ close: true })
  })
})

// A chapter row must sit over a fully stamped range: a refused group, or an action in it that
// noops, fails the close, and its abort reverses whatever landed.
describe('a close whose group does not land whole', () => {
  afterEach(() => {
    configureDeltaActionPort(realDeltaActionPort())
  })

  it('fails as action-layer when the group is refused whole, writing nothing', async () => {
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      applyDeltaActionGroupWithOutcomes: async (): Promise<GroupOutcome> => ({
        status: 'rejected',
        reason: 'forced refusal',
      }),
    })
    const before = await branchState()

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({
      kind: 'action-layer',
      detail: 'chapter-close: createChapter and 7 stampEntryChapter not applied: forced refusal',
    })
    expect(await branchState()).toEqual(before)
  })

  it('fails as action-layer naming the action a noop left unwritten, and reverses what landed', async () => {
    let landed = 0
    configureDeltaActionPort({
      ...realDeltaActionPort(),
      applyDeltaActionGroupWithOutcomes: async (actions, args, ctx) => {
        const real = await applyDeltaActionGroupWithOutcomes(actions, args, ctx)
        if (real.status !== 'ok') return real
        landed = real.outcomes.filter((o) => o.status === 'landed').length
        const last = real.outcomes.length - 1
        return {
          status: 'ok',
          outcomes: real.outcomes.map(
            (o, i): ActionOutcome => (i === last ? { status: 'noop', reason: 'forced noop' } : o),
          ),
        }
      },
    })
    const before = await branchState()

    const run = await runClose(f.replyIds[2]!)

    // The create and seven stamps really landed before the phase failed.
    expect(landed).toBe(8)
    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({
      kind: 'action-layer',
      detail: 'chapter-close: stampEntryChapter not applied: forced noop',
    })
    expect(await branchState()).toEqual(before)
    expect([...entriesStore.getEntries().values()].every((e) => e.chapterId === null)).toBe(true)
    expect(chaptersStore.getChapters().size).toBe(0)
  })
})

// Criterion 6.
describe('a failed close', () => {
  const OVER = {
    detectedBy: 'check',
    estimate: 71_234,
    window: 65_536,
    windowSource: 'configured',
    providerId: 'prov_close',
    modelId: 'lore-model',
  } as const
  const CUT = {
    cause: 'max-output',
    outputTokens: 512,
    reasoningTokens: null,
    maxOutput: 512,
    window: null,
    providerId: 'prov_close',
    modelId: 'lore-model',
  } as const

  it.each([
    [
      'a provider failure',
      { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
      { kind: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
    ],
    [
      'a reply that never parsed',
      { tier: 'parse', detail: 'the reply held no JSON object', attempt: 2 },
      { kind: 'phase-logic', detail: 'the reply held no JSON object' },
    ],
    [
      'a window refusal',
      { tier: 'context-window', ...OVER },
      { kind: 'context-window', target: 'lore-mgmt', ...OVER },
    ],
    [
      'a reply cut off',
      { tier: 'reply-cut-off', ...CUT },
      { kind: 'reply-cut-off', target: 'lore-mgmt', ...CUT },
    ],
  ] as const)('fails on %s and writes no row', async (_label, callError, runError) => {
    vi.mocked(generateStructured).mockResolvedValue({
      status: 'failed',
      error: callError,
      recoverable: [],
    })
    const before = await branchState()

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual(runError)
    expect(await chapterRows()).toEqual([])
    expect(await branchState()).toEqual(before)
  })

  it("fails at the lore-mgmt profile's timeout, not the classifier's", async () => {
    await rewire(withTimeouts({ 'lore-mgmt': 0.05, classifier: 2 }))
    abortsOnSignal()

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({
      kind: 'provider',
      reason: 'timeout',
      detail: 'lore-mgmt: timeout after 50ms',
    })
    expect(await chapterRows()).toEqual([])
  })

  it('fails at pre-flight, with no provider call, when lore-mgmt is unassigned', async () => {
    await rewire(({ assignments: { 'lore-mgmt': _unassigned, ...assignments }, ...s }) => ({
      ...s,
      assignments,
    }))
    const events = recordEvents()

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('failed')
    expect(run.error).toEqual({
      kind: 'config-resolver',
      failure: 'no-profile-assigned',
      target: 'lore-mgmt',
      phaseName: 'boundary',
    })
    expect(generateStructured).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'phase_start')).toBe(false)
    expect(await chapterRows()).toEqual([])
  })
})

describe('the agent phase with the production slots', () => {
  it('ships every slot empty', () => {
    expect(closeAgentSlots()).toBe(PRODUCTION_CLOSE_SLOTS)
    expect(PRODUCTION_CLOSE_SLOTS).toEqual({ before: [], perPart: [], after: [] })
  })

  it('freezes the slot table and each slot', () => {
    expect(Object.isFrozen(PRODUCTION_CLOSE_SLOTS)).toBe(true)
    for (const slot of Object.values(PRODUCTION_CLOSE_SLOTS))
      expect(Object.isFrozen(slot)).toBe(true)
  })

  it('still ends with the row, its stamps and a report of no tool calls, starting no task', async () => {
    const end = f.replyIds[2]!
    const events = recordEvents()
    let ledgerAtAgentEnd: unknown
    pipelineEventBus.subscribeAll((event) => {
      if (event.type === 'phase_complete' && event.name === 'agent')
        ledgerAtAgentEnd = closeLedgerOf(liveClose()!.intermediates)
    })

    const run = await runClose(end)

    expect(run.outcome).toBe('completed')
    expect(events.filter((event) => event.type === 'close_task_start')).toEqual([])
    expect(ledgerAtAgentEnd).toEqual({ calls: [], stopped: [], noToolCalls: true })
    const [row] = await chapterRows()
    expect(row!.closeReport).toEqual({
      version: 1,
      actionId: run.actionId,
      calls: [],
      stopped: [],
      noToolCalls: true,
    })
    for (const entry of await entryRows())
      expect(entry.chapterId, `entry ${entry.position}`).toBe(
        entry.position <= positionOf(end) ? row!.id : null,
      )
  })
})
