import { and, asc, eq, gt, gte, lte, ne, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isContentEditDelta } from '@/lib/actions/story-entries/classifier-facts'
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

import { METADATA_REPLY, openCloseFixture, type CloseFixture } from './__tests__/close-fixture'
import { CHAPTER_CLOSE_RESOLVES, ensureChapterClosePipelineRegistered } from './chapter-close'
import { closeAgentPhase } from './chapter-close-agent'
import { closeBoundaryPhase } from './chapter-close-boundary'
import { closeMetadataPhase } from './chapter-close-metadata'
import { closeReportPhase } from './chapter-close-report'
import { readClassifierStatus } from './memory-chain'
import { expectRan } from '../__tests__/harness'
import { __resetRegistry, getPipeline } from '../authoring/registry'
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
  vi.mocked(generateStructured).mockResolvedValue({
    status: 'ok',
    value: METADATA_REPLY,
    recoverable: [],
  })
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
      .select({ targetId: deltas.targetId, actionId: deltas.actionId })
      .from(deltas)
      .where(and(eq(deltas.targetTable, 'story_entries'), eq(deltas.op, 'create')))
    expect(creates.map((d) => d.targetId).sort()).toEqual(
      f.entries
        .slice(1)
        .map((e) => e.id)
        .sort(),
    )
    expect(new Set(creates.map((d) => d.actionId)).size).toBe(6)
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
})

// Criterion 5.
describe('a cancelled close', () => {
  it('lands no stamp after a cancel that follows the k-th, and leaves the branch as it was', async () => {
    const K = 3
    const before = await branchState()
    const emitted: string[] = []
    let stamps = 0
    // Counted as the run writes: the reversal that follows emits no delta event.
    pipelineEventBus.subscribe('delta_emitted', (event) => {
      emitted.push(event.action.kind)
      if (event.action.kind === 'stampEntryChapter' && ++stamps === K)
        liveClose()?.abortController.abort()
    })

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('aborted')
    expect(emitted).toEqual([
      'createChapter',
      ...Array.from({ length: K }, () => 'stampEntryChapter'),
    ])
    expect(await branchState()).toEqual(before)
    expect([...entriesStore.getEntries().values()].every((e) => e.chapterId === null)).toBe(true)
    expect(chaptersStore.getChapters().size).toBe(0)
    expect(generationStore.getTxState().deferred.get(f.branchId)).toEqual({ close: true })
  })

  it('writes nothing when cancelled during the metadata call', async () => {
    vi.mocked(generateStructured).mockImplementation(async () => {
      liveClose()?.abortController.abort()
      return { status: 'aborted', recoverable: [] }
    })
    const before = await branchState()
    const emitted: unknown[] = []
    pipelineEventBus.subscribe('delta_emitted', (event) => {
      emitted.push(event)
    })

    const run = await runClose(f.replyIds[2]!)

    expect(run.outcome).toBe('aborted')
    expect(emitted).toEqual([])
    expect(await branchState()).toEqual(before)
    expect(generationStore.getTxState().deferred.get(f.branchId)).toEqual({ close: true })
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
