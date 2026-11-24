import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { generateStructured, generateToolStep } from '@/lib/ai'
import { CHAPTER_CLOSE_KIND } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { branches, chapters, reversalJournals, storyEntries } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  CLASSIFIER_HELD,
  CLOSE_PHASE,
  ensurePerTurnPipelineRegistered,
  isClassifierHeld,
  PER_TURN_KIND,
  pipelineEventBus,
  type ChainEnd,
} from '@/lib/pipeline'
import {
  branchLog,
  closedChapterId,
  defined,
  installCloseHarnessHooks,
  openHarness,
  script,
  STAND_IN_STEP,
  TOBIN,
  type CloseCase,
  type CloseHarness,
  type CloseMocks,
  type ScriptedStep,
} from '@/lib/pipeline/__tests__/close-harness'
import { standInSlots } from '@/lib/pipeline/__tests__/close-stand-in'
import { expectRan, within } from '@/lib/pipeline/__tests__/harness'
import {
  setClassifierStatus,
  writeTurnEntry,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import {
  appSettingsStore,
  currentStoryStore,
  generationStore,
  hydrateAppSettings,
  interruptMemoryRuns,
  isBranchHeld,
  isStoryBusy,
  RERUN_HELD,
  type OpenStory,
} from '@/lib/stores'

import { MANUAL_CLOSE_REFUSAL } from './close-chain'
import {
  checkCloseRerunParent,
  CLOSE_RERUN_REFUSAL,
  CLOSE_RERUN_TURNS_FOLLOWED,
  getCloseRerunPreview,
  startCloseRerun,
  startCloseRerunOnFork,
  type CloseRerunExpected,
  type CloseRerunPreview,
  type CloseRerunStart,
} from './close-rerun'
import { startManualClose } from './start-manual-close'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { forkBranch } from '../stories/fork-branch'
import { loadOpenStory } from '../stories/operational'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '../story-entries/operational'
import {
  registerStandInPass,
  registerStoreOnlyRun,
  type StandInPass,
} from '../turns/__tests__/stand-in-pass'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

const MOCKS: CloseMocks = {
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}

installCloseHarnessHooks(MOCKS)

// The close writes the Harrow ferry lore row and Tobin's description; a re-run writes them again.
const STAND_IN: CloseCase = { slots: standInSlots, steps: [STAND_IN_STEP], merge: false }

const NETWORK_FAILURE: ScriptedStep = {
  calls: [],
  failed: { tier: 'provider', reason: 'network', detail: 'connect ECONNREFUSED' },
}

// What a confirm hands the start for a chapter its preview refuses: nothing to compare.
const NOTHING_SHOWN: CloseRerunExpected = {
  shortcut: null,
  reversal: { createdLore: { count: 0, userEdited: false }, otherChanges: 0 },
}

type Closed = { h: CloseHarness; chapterId: string }

async function closed(): Promise<Closed> {
  const h = await openHarness(STAND_IN, MOCKS)
  await h.close()
  return { h, chapterId: closedChapterId(h) }
}

// The chapter's last turn left past the watermark: the re-run's chain starts with a catch-up pass.
// The stand-in pass registers before the close, whose start would otherwise fill the kind.
async function closedWithCatchUp(): Promise<Closed & { pass: StandInPass }> {
  const pass = registerStandInPass({ anchorEntryId: null })
  const c = await closed()
  await setClassifierStatus(c.h.fx, { state: 'idle', processedThrough: endPosition(c.h) - 1 })
  return { ...c, pass }
}

function endPosition(h: CloseHarness): number {
  return defined(
    h.fx.entries.find((entry) => entry.id === h.endEntryId),
    'E is not a fixture entry',
  ).position
}

function openStory(): OpenStory {
  return defined(currentStoryStore.getCurrentStory() ?? undefined, 'no story is open')
}

/** A turn taken after the close: its creates sit above the close's group, so it is a turn since. */
async function turnSince(h: CloseHarness): Promise<{ action: string; reply: string }> {
  const position = defined(h.fx.entries.at(-1), 'the fixture has no entry').position + 1
  const action = `entry_since_${position}`
  const reply = `entry_since_${position + 1}`
  await writeTurnEntry(h.fx, 'act_turn_since', {
    id: action,
    position,
    kind: 'user_action',
    content: 'I ask the guard whether the reeve sits in Low Ashby tonight.',
  })
  await writeTurnEntry(h.fx, 'act_turn_since', {
    id: reply,
    position: position + 1,
    kind: 'ai_reply',
    content: 'The guard shrugs. The reeve keeps no hours a courier would like, he says.',
  })
  return { action, reply }
}

async function previewOf({ h, chapterId }: Closed): Promise<CloseRerunPreview> {
  const read = await getCloseRerunPreview(h.fx.branchId, chapterId, openStory(), h.fx.ctx)
  if ('status' in read) throw new Error(`the preview refused: ${read.code}`)
  return read
}

// What the confirm hands the start: the shortcut and the counts it showed.
function expectedOf(preview: CloseRerunPreview): CloseRerunExpected {
  const { shortcut } = preview
  return {
    shortcut: shortcut && { targetEntryId: shortcut.targetEntryId, counts: shortcut.counts },
    reversal: preview.reversal,
  }
}

type StartOpts = { onStarted?: () => void; steps?: readonly ScriptedStep[] }

// The close used up its script, so the re-run's model is scripted again from its first step.
function start(
  { h, chapterId }: Closed,
  expected: CloseRerunExpected,
  opts: StartOpts = {},
): Promise<CloseRerunStart> {
  script(generateToolStepMock, opts.steps ?? [STAND_IN_STEP])
  return startCloseRerun(h.fx.branchId, chapterId, expected, h.fx.ctx, {
    onStarted: opts.onStarted,
  })
}

function chainEnd(result: CloseRerunStart): ChainEnd {
  if ('result' in result) return result
  throw new Error(`the re-run did not start: ${JSON.stringify(result)}`)
}

async function entryCount(h: CloseHarness): Promise<number> {
  const rows = await h.fx.ctx.db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, h.fx.branchId))
  return rows.length
}

async function journals(h: CloseHarness) {
  return h.fx.ctx.db
    .select()
    .from(reversalJournals)
    .where(eq(reversalJournals.branchId, h.fx.branchId))
}

const pendingRerunOn = (h: CloseHarness): boolean =>
  generationStore.getTxState().pendingRerun.has(h.fx.branchId)

type Snapshot = { entries: number; log: Awaited<ReturnType<typeof branchLog>> }

async function snapshot(h: CloseHarness): Promise<Snapshot> {
  return { entries: await entryCount(h), log: await branchLog(h.fx) }
}

// A refusal before the shortcut leaves the entries, the log and every record as they were.
async function expectNothingChanged(h: CloseHarness, before: Snapshot): Promise<void> {
  expect(await entryCount(h), 'story_entries').toBe(before.entries)
  expect(await branchLog(h.fx), 'the delta log').toEqual(before.log)
  expect(await journals(h), 'reversal_journals').toEqual([])
  expect(pendingRerunOn(h), 'pendingRerun').toBe(false)
  expect(generationStore.getTxState().pendingTurns.size, 'pending marks').toBe(0)
}

// A turn in flight on the close's own story; the hooks' reset ends it.
function holdStoryWithTurn(h: CloseHarness): void {
  ensurePerTurnPipelineRegistered()
  generationStore.startRun({
    runId: 'run_same_story',
    kind: PER_TURN_KIND,
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_same_story',
    storyId: h.fx.storyId,
    branchId: h.fx.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

// Caches `modelId` on the fixture's provider with only its tool-calling flag.
async function flagToolCalling(modelId: string, toolCalling: boolean): Promise<void> {
  const settings = appSettingsStore.getAppSettings()
  const next = {
    ...settings,
    providers: settings.providers.map((p) => ({
      ...p,
      cachedModels: [
        ...(p.cachedModels ?? []).filter((m) => m.id !== modelId),
        { id: modelId, capabilities: { toolCalling } },
      ],
    })),
  }
  expect(await hydrateAppSettings(async () => next)).toEqual({ status: 'ok' })
}

// The memory pass's assignment pointed at a profile that no longer exists.
async function assignClassifier(profileId: string): Promise<void> {
  const settings = appSettingsStore.getAppSettings()
  const next = { ...settings, assignments: { ...settings.assignments, classifier: profileId } }
  expect(await hydrateAppSettings(async () => next)).toEqual({ status: 'ok' })
}

// Whether the record held as each re-run's boundary began; armed after the close.
function recordAtBoundary(h: CloseHarness): () => readonly boolean[] {
  const seen: boolean[] = []
  pipelineEventBus.subscribe('phase_start', (event) => {
    if (event.name === CLOSE_PHASE.boundary) seen.push(pendingRerunOn(h))
  })
  return () => seen
}

// Cancel lands as the re-run's reversal completes, before its first own write.
function cancelAfterReversal(h: CloseHarness): void {
  const off = pipelineEventBus.subscribe('phase_complete', (event) => {
    if (event.name !== CLOSE_PHASE.reversal) return
    off()
    void interruptMemoryRuns(h.fx.branchId)
  })
}

type Started = { marks: number; runs: string[] }

// What onStarted saw: the pending marks left and the branch's runs, each as kind:slot.
function watchStarts(h: CloseHarness): { onStarted: () => void; seen: Started[] } {
  const seen: Started[] = []
  return {
    seen,
    onStarted: () => {
      const tx = generationStore.getTxState()
      seen.push({
        marks: tx.pendingTurns.size,
        runs: [...tx.runs.values()]
          .filter((run) => run.branchId === h.fx.branchId)
          .map((run) => `${run.kind}:${String(run.interruptible)}`),
      })
    },
  }
}

const MOVED: readonly (readonly [string, (shown: CloseRerunExpected) => CloseRerunExpected])[] = [
  [
    "the shortcut's counts",
    (shown) => ({
      ...shown,
      shortcut: shown.shortcut && {
        ...shown.shortcut,
        counts: { ...shown.shortcut.counts, entries: shown.shortcut.counts.entries + 1 },
      },
    }),
  ],
  ['the shortcut itself', (shown) => ({ ...shown, shortcut: null })],
  [
    "the shortcut's target alone",
    (shown) => ({
      ...shown,
      shortcut: shown.shortcut && { ...shown.shortcut, targetEntryId: 'entry_elsewhere' },
    }),
  ],
  [
    "the reversal's counts",
    (shown) => ({
      ...shown,
      reversal: { ...shown.reversal, otherChanges: shown.reversal.otherChanges + 1 },
    }),
  ],
  [
    "the reversal's created lore",
    (shown) => ({
      ...shown,
      reversal: {
        ...shown.reversal,
        createdLore: { ...shown.reversal.createdLore, count: shown.reversal.createdLore.count + 1 },
      },
    }),
  ],
  [
    "the created lore's user edit",
    (shown) => ({
      ...shown,
      reversal: {
        ...shown.reversal,
        createdLore: {
          ...shown.reversal.createdLore,
          userEdited: !shown.reversal.createdLore.userEdited,
        },
      },
    }),
  ],
]

describe('startCloseRerun refuses before the turns go (AC 19)', () => {
  it('refuses story-busy while a run holds the story, starting nothing', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    holdStoryWithTurn(c.h)
    const before = await snapshot(c.h)
    const onStarted = vi.fn()

    expect(await start(c, expected, { onStarted })).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.busy,
    })
    await expectNothingChanged(c.h, before)
    expect(onStarted).not.toHaveBeenCalled()
  })

  // A run settling during the held read makes it stale (a pass can end there held); otherwise
  // only the chain would see that, once the turns had gone.
  it('refuses story-busy when a run settles during the held read, starting nothing', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    holdStoryWithTurn(c.h)
    const before = await snapshot(c.h)
    const onStarted = vi.fn()
    let selects = 0
    const db = new Proxy(c.h.fx.ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'select' && selects++ === 0) generationStore.finishRun('run_same_story')
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    script(generateToolStepMock, [STAND_IN_STEP])

    const result = await startCloseRerun(
      c.h.fx.branchId,
      c.chapterId,
      expected,
      { ...c.h.fx.ctx, db },
      { onStarted },
    )

    expect(generationStore.getTxState().runs.has('run_same_story'), 'the run settled').toBe(false)
    expect(result).toEqual({ outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.busy })
    await expectNothingChanged(c.h, before)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('refuses a held branch, and a branch the open story is not on', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    const before = await snapshot(c.h)

    // A pass left `running` with none live holds the branch.
    await setClassifierStatus(c.h.fx, { state: 'running', processedThrough: endPosition(c.h) })
    expect(await start(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: CLASSIFIER_HELD,
    })
    currentStoryStore.__reset()
    expect(await start(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen,
    })
    await expectNothingChanged(c.h, before)
  })

  it('refuses not-latest for a chapter a later close followed', async () => {
    const c = await closed()
    const later = expectRan(
      await startManualClose(c.h.fx.branchId, c.h.fx.replyIds[4]!, c.h.fx.ctx),
    )
    expect(later.outcome).toBe('completed')
    const before = await snapshot(c.h)

    expect(await start(c, NOTHING_SHOWN)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.notLatest,
    })
    await expectNothingChanged(c.h, before)
  })

  it('refuses no-close for a latest chapter no close wrote', async () => {
    const c = await closed()
    await c.h.fx.ctx.db.insert(chapters).values({
      id: 'chap_by_hand',
      branchId: c.h.fx.branchId,
      sequenceNumber: 2,
      title: 'By hand',
      summary: 'Written with no close.',
      theme: 'None',
      startEntryId: c.h.fx.entries[7]!.id,
      endEntryId: c.h.fx.replyIds[4]!,
      tokenCount: 1,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const before = await snapshot(c.h)

    expect(await start({ ...c, chapterId: 'chap_by_hand' }, NOTHING_SHOWN)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.noClose,
    })
    await expectNothingChanged(c.h, before)
  })

  it('refuses close-owed for a pending pick the shortcut would leave standing', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    generationStore.setPendingClose(c.h.fx.branchId, { endEntryId: c.h.fx.replyIds[4]! })
    const before = await snapshot(c.h)

    expect(await start(c, expected)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.closeOwed,
    })
    await expectNothingChanged(c.h, before)
  })

  it('refuses close-owed with auto-close on and the region the shortcut leaves at the threshold', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    const open = openStory()
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, chapterAutoClose: true, chapterTokenThreshold: 1 },
    })
    const before = await snapshot(c.h)

    expect(await start(c, expected)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.closeOwed,
    })
    await expectNothingChanged(c.h, before)
  })

  it('refuses a lore-mgmt model flagged off for tool calling, before the turns go', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    await flagToolCalling('lore-model', false)
    const before = await snapshot(c.h)
    const onStarted = vi.fn()

    expect(await start(c, expected, { onStarted })).toEqual({
      outcome: 'preflight-failed',
      error: {
        kind: 'config-resolver',
        failure: 'tool-calling-off',
        target: 'lore-mgmt',
        phaseName: 'agent',
        modelId: 'lore-model',
      },
    })
    await expectNothingChanged(c.h, before)
    expect(onStarted).not.toHaveBeenCalled()
  })

  // A catch-up pass whose settings fail would end the chain after the turns went.
  it("refuses a catch-up pass's missing memory profile, before the turns go", async () => {
    const c = await closed()
    await setClassifierStatus(c.h.fx, { state: 'idle', processedThrough: endPosition(c.h) - 1 })
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    expect(expected.shortcut, 'the start would roll the turn back').not.toBeNull()
    await assignClassifier('prof_gone')
    const before = await snapshot(c.h)
    const onStarted = vi.fn()

    expect(await start(c, expected, { onStarted })).toMatchObject({
      outcome: 'preflight-failed',
      error: { kind: 'config-resolver', failure: 'profile-missing', target: 'classifier' },
    })
    await expectNothingChanged(c.h, before)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('checks no memory setting when no catch-up pass is due', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    await assignClassifier('prof_gone')

    const end = chainEnd(await start(c, expected))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
  })

  it.each(MOVED)(
    'refuses counts-changed when %s moved, carrying the fresh preview',
    async (_label, move) => {
      const c = await closed()
      await turnSince(c.h)
      const fresh = await previewOf(c)
      const before = await snapshot(c.h)
      const onStarted = vi.fn()
      const moved = move(expectedOf(fresh))
      expect(moved, 'the row moved nothing').not.toEqual(expectedOf(fresh))

      expect(await start(c, moved, { onStarted })).toEqual({
        status: 'rejected',
        code: 'counts-changed',
        reason: expect.any(String),
        preview: fresh,
      })
      await expectNothingChanged(c.h, before)
      expect(onStarted).not.toHaveBeenCalled()
    },
  )

  it("maps the shortcut's own recount to counts-changed, with the preview read again under the mark", async () => {
    const c = await closed()
    const { reply } = await turnSince(c.h)
    const shown = await previewOf(c)
    const entries = await entryCount(c.h)
    // A turn's classifier fact naming Tobin lands as the shortcut's bracket rises: past the
    // preview, before the sweep. Its shared hold comes first, so the sweep's exclusive one waits.
    let fact: ReturnType<typeof applyDeltaAction> | undefined
    const off = generationStore.subscribe(() => {
      if (fact !== undefined || !generationStore.getTxState().reversalInProgress) return
      fact = applyDeltaAction(
        {
          action: {
            kind: 'updateEntity',
            source: 'per_turn_classifier',
            payload: {
              branchId: c.h.fx.branchId,
              id: TOBIN.id,
              patch: { keywords: ['the ferryman'] },
            },
          },
          actionId: 'act_fact_since',
          branchId: c.h.fx.branchId,
          entryId: reply,
        },
        c.h.fx.ctx,
      )
    })

    const result = await start(c, expectedOf(shown))
    off()

    expect(await defined(fact, 'no fact landed as the bracket rose')).toMatchObject({
      status: 'ok',
    })
    const reread = await previewOf(c)
    expect(result).toEqual({
      status: 'rejected',
      code: 'counts-changed',
      reason: expect.any(String),
      preview: reread,
    })
    expect(reread.shortcut?.counts.worldStateChanges).toBe(
      defined(shown.shortcut ?? undefined, 'no shortcut shown').counts.worldStateChanges + 1,
    )
    expect(await entryCount(c.h), 'the turn since stays').toBe(entries)
    expect(await journals(c.h)).toEqual([])
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
  })
})

describe('startCloseRerun holds the gate from its preview to the re-run', () => {
  it('keeps the gate shut from the shortcut until the re-run reserves, so a start in between is refused', async () => {
    const c = await closed()
    const { action } = await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    expect(expected.shortcut?.targetEntryId).toBe(action)
    const before = await entryCount(c.h)
    let swept = false
    let reserved = false
    let openings = 0
    let racer: ReturnType<typeof startManualClose> | undefined
    // At every change between the sweep and the reserve: the gate the composer reads before a
    // Send, and a manual close started there.
    const off = generationStore.subscribe(() => {
      const tx = generationStore.getTxState()
      if (tx.reversalInProgress) swept = true
      if (!swept || reserved || tx.reversalInProgress) return
      if ([...tx.runs.values()].some((run) => run.kind === CHAPTER_CLOSE_KIND)) {
        reserved = true
        return
      }
      if (!generationStore.isUserEditBlocked()) openings += 1
      racer ??= startManualClose(c.h.fx.branchId, c.h.fx.replyIds[4]!, c.h.fx.ctx)
    })

    const end = chainEnd(await start(c, expected))
    off()

    expect(swept && reserved, 'the start swept, then reserved').toBe(true)
    expect(openings, 'the gate opened between the sweep and the reserve').toBe(0)
    expect(await defined(racer, 'no start raced the re-run')).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.busy,
    })
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(await entryCount(c.h), 'the turn since went').toBe(before - 2)
  })

  it('refuses a second start while the first holds its mark, so the turn goes once', async () => {
    const c = await closed()
    await turnSince(c.h)
    const expected = expectedOf(await previewOf(c))
    const before = await entryCount(c.h)
    script(generateToolStepMock, [STAND_IN_STEP])

    const results = await Promise.all([
      startCloseRerun(c.h.fx.branchId, c.chapterId, expected, c.h.fx.ctx),
      startCloseRerun(c.h.fx.branchId, c.chapterId, expected, c.h.fx.ctx),
    ])

    const ends = results.filter((result): result is ChainEnd => 'result' in result)
    expect(results.filter((result) => !('result' in result))).toEqual([
      { outcome: 'rejected', blockedBy: MANUAL_CLOSE_REFUSAL.busy },
    ])
    expect(ends).toHaveLength(1)
    const end = ends[0]!
    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(await entryCount(c.h)).toBe(before - 2)
    expect((await journals(c.h)).map((row) => row.actionId)).toEqual([end.result.actionId])
  })

  it('re-runs at once when no turn followed the close, removing no entry', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))
    expect(expected.shortcut).toBeNull()
    const before = await entryCount(c.h)

    const end = chainEnd(await start(c, expected))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(end.result.actionId).not.toBe(c.h.actionId())
    expect(await entryCount(c.h)).toBe(before)
    const [row] = await c.h.fx.ctx.db
      .select({ report: chapters.closeReport })
      .from(chapters)
      .where(eq(chapters.id, c.chapterId))
    expect(row?.report?.actionId).toBe(end.result.actionId)
  })
})

describe('pendingRerun is gone at every end of the start (AC 16)', () => {
  it('clears it when the orchestrator refuses the chain it was written for', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))
    // Another story's turn: the story isn't busy, but the close's start is blocked by the kind.
    ensurePerTurnPipelineRegistered()
    registerStoreOnlyRun(PER_TURN_KIND, 'br_elsewhere')
    let written = false
    const off = generationStore.subscribe(() => {
      if (pendingRerunOn(c.h)) written = true
    })
    const onStarted = vi.fn()

    const result = await start(c, expected, { onStarted })
    off()

    expect(result).toEqual({ outcome: 'rejected', blockedBy: PER_TURN_KIND })
    expect(written, 'the record was written before the chain started').toBe(true)
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(generationStore.getTxState().pendingTurns.size).toBe(0)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('holds it through the re-run and clears it as the re-run commits, firing onStarted once as it reserves', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))
    const atBoundary = recordAtBoundary(c.h)
    const starts = watchStarts(c.h)

    const end = chainEnd(await start(c, expected, { onStarted: starts.onStarted }))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(atBoundary()).toEqual([true])
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(starts.seen).toEqual([{ marks: 0, runs: [`${CHAPTER_CLOSE_KIND}:rerun`] }])
  })

  it('runs the re-run to its end past an onStarted that throws, leaving no run registered', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))
    const warn = vi.spyOn(logger, 'warn')

    const result = await start(c, expected, {
      onStarted: () => {
        throw new Error('the host threw')
      },
    }).catch((e: unknown) => e)

    expect(
      [...generationStore.getTxState().runs.values()].map((run) => run.branchId),
      'runs left registered',
    ).toEqual([])
    expect(result).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(warn).toHaveBeenCalledWith('action_layer.close_rerun_on_started_threw', {
      branchId: c.h.fx.branchId,
      error: 'the host threw',
    })
  })

  it('clears it when Cancel ends the re-run, recording no deferral', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))
    cancelAfterReversal(c.h)

    const end = chainEnd(await start(c, expected))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'aborted' } })
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(generationStore.getTxState().deferred.has(c.h.fx.branchId)).toBe(false)
  })

  it('clears it when the re-run fails, recording no deferral', async () => {
    const c = await closed()
    const expected = expectedOf(await previewOf(c))

    const end = chainEnd(await start(c, expected, { steps: [NETWORK_FAILURE] }))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'failed' } })
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(generationStore.getTxState().deferred.has(c.h.fx.branchId)).toBe(false)
  })

  it('clears it when the catch-up pass fails', async () => {
    const c = await closedWithCatchUp()
    const expected = expectedOf(await previewOf(c))
    const started = start(c, expected)
    const held = await within(c.pass.nextHeld(), 'the catch-up pass')
    expect(pendingRerunOn(c.h), 'the record holds through the pass').toBe(true)

    held.finish('failed')
    const end = chainEnd(await within(started, 'the start'))

    expect(end).toMatchObject({ kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'failed' } })
    expect(pendingRerunOn(c.h)).toBe(false)
  })

  it('clears it when Cancel ends the catch-up pass, which defers as any pass does', async () => {
    const c = await closedWithCatchUp()
    const expected = expectedOf(await previewOf(c))
    const started = start(c, expected)
    await within(c.pass.nextHeld(), 'the catch-up pass')

    await interruptMemoryRuns(c.h.fx.branchId)
    const end = chainEnd(await within(started, 'the start'))

    expect(end).toMatchObject({ kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'aborted' } })
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(generationStore.getTxState().deferred.get(c.h.fx.branchId)).toEqual({ pass: true })
  })

  it('clears it when a rollback sparing the chapter interrupts the catch-up pass', async () => {
    const c = await closedWithCatchUp()
    const expected = expectedOf(await previewOf(c))
    const started = start(c, expected)
    await within(c.pass.nextHeld(), 'the catch-up pass')
    const target = defined(c.h.fx.replyIds.at(-1), 'the fixture has no reply')
    const counts = await shownCounts(c.h.fx.branchId, target, c.h.fx.ctx)

    expect(
      await rollbackToEntry(c.h.fx.branchId, target, c.h.fx.ctx, { expectedCounts: counts }),
    ).toEqual({ status: 'ok', counts })
    const end = chainEnd(await within(started, 'the start'))

    expect(end).toMatchObject({ kind: PERIODIC_CLASSIFIER_KIND, result: { outcome: 'aborted' } })
    expect(pendingRerunOn(c.h)).toBe(false)
  })

  it('holds it from the catch-up pass into the re-run, firing onStarted once, as the pass reserves', async () => {
    const c = await closedWithCatchUp()
    const expected = expectedOf(await previewOf(c))
    const atBoundary = recordAtBoundary(c.h)
    const starts = watchStarts(c.h)
    const started = start(c, expected, { onStarted: starts.onStarted })
    const held = await within(c.pass.nextHeld(), 'the catch-up pass')

    held.finish('completed')
    const end = chainEnd(await within(started, 'the start'))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(atBoundary()).toEqual([true])
    expect(pendingRerunOn(c.h)).toBe(false)
    expect(starts.seen).toEqual([{ marks: 0, runs: [`${PERIODIC_CLASSIFIER_KIND}:pass`] }])
  })
})

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// A re-run whose abort's reversal didn't commit holds its branch until a restart; no run stays.
function holdUntilRestart(h: CloseHarness): void {
  generationStore.startRun({
    runId: 'run_held_rerun',
    kind: CHAPTER_CLOSE_KIND,
    gateBehavior: 'hard-gate',
    interruptible: 'rerun',
    beforeTurn: false,
    actionId: 'act_held_rerun',
    storyId: h.fx.storyId,
    branchId: h.fx.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
  generationStore.abortRun('run_held_rerun', 'failed', { unreversed: true })
}

async function branchIdsOf(h: CloseHarness): Promise<string[]> {
  const rows = await h.fx.ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.storyId, h.fx.storyId))
  return rows.map((row) => row.id)
}

// The check forks nothing and writes nothing, whatever it answers.
async function expectCheckedOnly(h: CloseHarness, before: Snapshot): Promise<void> {
  await expectNothingChanged(h, before)
  expect(await branchIdsOf(h), 'branches').toEqual([h.fx.branchId])
}

// A turn since the close, and the counts the confirm then shows over it.
async function shownWithTurn(c: Closed): Promise<CloseRerunExpected> {
  await turnSince(c.h)
  return expectedOf(await previewOf(c))
}

const checkParent = ({ h, chapterId }: Closed, expected: CloseRerunExpected) =>
  checkCloseRerunParent(h.fx.branchId, chapterId, expected, h.fx.ctx)

describe('checkCloseRerunParent (AC 13)', () => {
  it('clears an orphan-held parent with its fresh preview, whose fork point is the reply before B', async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    // A pass left `running` with none live: the in-place start refuses this as classifier-held.
    await setClassifierStatus(c.h.fx, { state: 'running', processedThrough: endPosition(c.h) })
    expect(await isClassifierHeld(c.h.fx.branchId, c.h.fx.ctx)).toBe(true)
    const before = await snapshot(c.h)

    const result = await checkParent(c, expected)

    expect(result).toEqual({ status: 'clear', preview: await previewOf(c) })
    const last = defined(c.h.fx.entries.at(-1), 'the fixture has no entry')
    expect(last.kind).toBe('ai_reply')
    expect(result).toMatchObject({
      preview: { shortcut: { forkPoint: { entryId: last.id, position: last.position } } },
    })
    expect(generationStore.getTxState().runs.size, 'runs').toBe(0)
    await expectCheckedOnly(c.h, before)
  })

  it('refuses branch-not-open while the open story is on another branch', async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    currentStoryStore.set({ ...openStory(), branchId: 'br_elsewhere' })
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen,
    })
    await expectCheckedOnly(c.h, before)
  })

  it('refuses a pending embedder swap', async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    const open = openStory()
    currentStoryStore.set({
      ...open,
      settings: { ...open.settings, embedding_swap_target: 'other-embedder' },
    })
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.swapPending,
    })
    await expectCheckedOnly(c.h, before)
  })

  it('refuses a branch held until a restart', async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    holdUntilRestart(c.h)
    expect(isBranchHeld(generationStore.getTxState(), c.h.fx.branchId)).toBe(true)
    expect(isStoryBusy(generationStore.getTxState(), c.h.fx.storyId, c.h.fx.branchId)).toBe(false)
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: RERUN_HELD,
    })
    await expectCheckedOnly(c.h, before)
  })

  it('refuses story-busy while a run holds the story', async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    holdStoryWithTurn(c.h)
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.busy,
    })
    await expectCheckedOnly(c.h, before)
  })

  it("refuses story-busy while a turn body still runs on the parent past its mark's end", async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    const before = await snapshot(c.h)
    const sweep = deferred()
    const body = generationStore.bracketPendingTurn(c.h.fx.branchId, async (endEarly) => {
      endEarly()
      await sweep.promise
    })
    try {
      expect(isStoryBusy(generationStore.getTxState(), c.h.fx.storyId, c.h.fx.branchId)).toBe(false)
      expect(generationStore.isTurnBodyActive(c.h.fx.branchId)).toBe(true)

      expect(await checkParent(c, expected)).toEqual({
        outcome: 'rejected',
        blockedBy: MANUAL_CLOSE_REFUSAL.busy,
      })
    } finally {
      sweep.resolve()
      await body
    }
    await expectCheckedOnly(c.h, before)
  })

  it("refuses the close's failed pre-flight", async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    await flagToolCalling('lore-model', false)
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toEqual({
      outcome: 'preflight-failed',
      error: {
        kind: 'config-resolver',
        failure: 'tool-calling-off',
        target: 'lore-mgmt',
        phaseName: 'agent',
        modelId: 'lore-model',
      },
    })
    await expectCheckedOnly(c.h, before)
  })

  it('refuses not-latest for a chapter a later close followed', async () => {
    const c = await closed()
    const later = expectRan(
      await startManualClose(c.h.fx.branchId, c.h.fx.replyIds[4]!, c.h.fx.ctx),
    )
    expect(later.outcome).toBe('completed')
    const before = await snapshot(c.h)

    expect(await checkParent(c, NOTHING_SHOWN)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.notLatest,
    })
    await expectCheckedOnly(c.h, before)
  })

  it('refuses no-close for a latest chapter no close wrote', async () => {
    const c = await closed()
    await c.h.fx.ctx.db.insert(chapters).values({
      id: 'chap_by_hand',
      branchId: c.h.fx.branchId,
      sequenceNumber: 2,
      title: 'By hand',
      summary: 'Written with no close.',
      theme: 'None',
      startEntryId: c.h.fx.entries[7]!.id,
      endEntryId: c.h.fx.replyIds[4]!,
      tokenCount: 1,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const before = await snapshot(c.h)

    expect(await checkParent({ ...c, chapterId: 'chap_by_hand' }, NOTHING_SHOWN)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.noClose,
    })
    await expectCheckedOnly(c.h, before)
  })

  it("refuses close-owed for the parent's pending pick below B", async () => {
    const c = await closed()
    const expected = await shownWithTurn(c)
    generationStore.setPendingClose(c.h.fx.branchId, { endEntryId: c.h.fx.replyIds[4]! })
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.closeOwed,
    })
    await expectCheckedOnly(c.h, before)
  })

  it.each(MOVED)(
    'refuses counts-changed when %s moved, carrying the fresh preview',
    async (_label, move) => {
      const c = await closed()
      await turnSince(c.h)
      const fresh = await previewOf(c)
      const moved = move(expectedOf(fresh))
      expect(moved, 'the row moved nothing').not.toEqual(expectedOf(fresh))
      const before = await snapshot(c.h)

      expect(await checkParent(c, moved)).toEqual({
        status: 'rejected',
        code: 'counts-changed',
        reason: expect.any(String),
        preview: fresh,
      })
      await expectCheckedOnly(c.h, before)
    },
  )

  it('refuses counts-changed when no turn follows the close, carrying the fresh preview', async () => {
    const c = await closed()
    const fresh = await previewOf(c)
    expect(fresh.shortcut).toBeNull()
    const before = await snapshot(c.h)

    expect(await checkParent(c, expectedOf(fresh))).toEqual({
      status: 'rejected',
      code: 'counts-changed',
      reason: expect.any(String),
      preview: fresh,
    })
    await expectCheckedOnly(c.h, before)
  })

  it("refuses a catch-up pass's missing memory profile", async () => {
    const c = await closed()
    await setClassifierStatus(c.h.fx, { state: 'idle', processedThrough: endPosition(c.h) - 1 })
    const expected = await shownWithTurn(c)
    await assignClassifier('prof_gone')
    const before = await snapshot(c.h)

    expect(await checkParent(c, expected)).toMatchObject({
      outcome: 'preflight-failed',
      error: { kind: 'config-resolver', failure: 'profile-missing', target: 'classifier' },
    })
    await expectCheckedOnly(c.h, before)
  })
})

async function entryIdsOn(h: CloseHarness, branchId: string): Promise<string[]> {
  const rows = await h.fx.ctx.db
    .select({ id: storyEntries.id })
    .from(storyEntries)
    .where(eq(storyEntries.branchId, branchId))
    .orderBy(asc(storyEntries.position))
  return rows.map((row) => row.id)
}

async function reportActionOn(
  h: CloseHarness,
  branchId: string,
  chapterId: string,
): Promise<string | undefined> {
  const [row] = await h.fx.ctx.db
    .select({ report: chapters.closeReport })
    .from(chapters)
    .where(and(eq(chapters.branchId, branchId), eq(chapters.id, chapterId)))
  return row?.report?.actionId
}

// What the fork path's commit leaves: the child current in the DB, every store still on the parent.
async function forkAt(h: CloseHarness, forkEntryId: string): Promise<string> {
  const forked = await forkBranch(
    { parentBranchId: h.fx.branchId, forkEntryId, name: 'Ch. 1 re-run', makeCurrent: true },
    h.fx.ctx,
  )
  if (forked.status !== 'ok') throw new Error(`the fork refused: ${forked.code}`)
  return forked.branchId
}

// As the show-branch tail's publish leaves it: the open story on the child.
async function publish(h: CloseHarness, branchId: string): Promise<void> {
  expect(await loadOpenStory(branchId, h.fx.ctx)).toMatchObject({ status: 'ok' })
  expect(openStory().branchId).toBe(branchId)
}

function startOnFork(
  { h, chapterId }: Closed,
  child: string,
  onStarted?: () => void,
): Promise<CloseRerunStart> {
  script(generateToolStepMock, [STAND_IN_STEP])
  return startCloseRerunOnFork(child, chapterId, h.fx.ctx, { onStarted })
}

// A refusal on the new branch removes no entry there and leaves no record or mark behind.
async function expectNothingStartedOn(
  h: CloseHarness,
  child: string,
  entries: readonly string[],
): Promise<void> {
  expect(await entryIdsOn(h, child), 'the child entries').toEqual(entries)
  expect(
    await h.fx.ctx.db.select().from(reversalJournals).where(eq(reversalJournals.branchId, child)),
    'reversal_journals',
  ).toEqual([])
  expect(generationStore.getTxState().pendingRerun.has(child), 'pendingRerun').toBe(false)
  expect(generationStore.getTxState().pendingTurns.size, 'pending marks').toBe(0)
}

describe('startCloseRerunOnFork (AC 18)', () => {
  it("re-runs the chapter on a fresh fork at N whatever shortcut the parent's confirm showed", async () => {
    const c = await closed()
    const { reply } = await turnSince(c.h)
    const shown = await previewOf(c)
    const shortcut = defined(shown.shortcut ?? undefined, 'the confirm showed no turn since')
    expect(shortcut.turns).toBe(1)
    const child = await forkAt(c.h, shortcut.forkPoint.entryId)
    await publish(c.h, child)
    const kept = c.h.fx.entries.map((entry) => entry.id)
    expect(await entryIdsOn(c.h, child), 'the fork kept every entry before B').toEqual(kept)
    const parentEntries = await entryIdsOn(c.h, c.h.fx.branchId)
    const seen: { marks: number; runs: string[] }[] = []
    const onStarted = () => {
      const tx = generationStore.getTxState()
      seen.push({
        marks: tx.pendingTurns.size,
        runs: [...tx.runs.values()]
          .filter((run) => run.branchId === child)
          .map((run) => `${run.kind}:${String(run.interruptible)}`),
      })
    }

    const end = chainEnd(await startOnFork(c, child, onStarted))

    expect(end).toMatchObject({ kind: CHAPTER_CLOSE_KIND, result: { outcome: 'completed' } })
    expect(seen, 'onStarted, once, at the reserve').toEqual([
      { marks: 0, runs: [`${CHAPTER_CLOSE_KIND}:rerun`] },
    ])
    expect(await entryIdsOn(c.h, child), 'no entry went on the child').toEqual(kept)
    expect(await reportActionOn(c.h, child, c.chapterId)).toBe(end.result.actionId)
    expect(end.result.actionId).not.toBe(c.h.actionId())
    expect(await reportActionOn(c.h, c.h.fx.branchId, c.chapterId)).toBe(c.h.actionId())
    expect(await entryIdsOn(c.h, c.h.fx.branchId), 'the parent keeps the turn since').toEqual(
      parentEntries,
    )
    expect(parentEntries).toContain(reply)
    expect(generationStore.getTxState().pendingRerun.has(child)).toBe(false)
  })

  it('refuses turns-followed on a branch forked at its tail, removing no entry', async () => {
    const c = await closed()
    const { reply } = await turnSince(c.h)
    const child = await forkAt(c.h, reply)
    await publish(c.h, child)
    const entries = await entryIdsOn(c.h, child)
    expect(entries).toContain(reply)
    const onStarted = vi.fn()

    const result = await startOnFork(c, child, onStarted)

    expect(result).toEqual({
      status: 'rejected',
      code: CLOSE_RERUN_TURNS_FOLLOWED,
      reason: expect.any(String),
    })
    expect(CLOSE_RERUN_TURNS_FOLLOWED).toBe('turns-followed')
    await expectNothingStartedOn(c.h, child, entries)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('refuses story-busy before turns-followed while a run started on the parent holds the story', async () => {
    const c = await closed()
    const { reply } = await turnSince(c.h)
    // The child keeps the turn since, so only a check ahead of turns-followed can refuse this.
    const child = await forkAt(c.h, reply)
    await publish(c.h, child)
    holdStoryWithTurn(c.h)
    const entries = await entryIdsOn(c.h, child)
    const onStarted = vi.fn()

    expect(await startOnFork(c, child, onStarted)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.busy,
    })
    await expectNothingStartedOn(c.h, child, entries)
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('refuses branch-not-open before turns-followed while the open story is still on the parent', async () => {
    const c = await closed()
    const { reply } = await turnSince(c.h)
    // The child keeps the turn since, so only a check ahead of turns-followed can refuse this.
    const child = await forkAt(c.h, reply)
    expect(openStory().branchId).toBe(c.h.fx.branchId)
    const entries = await entryIdsOn(c.h, child)
    const onStarted = vi.fn()

    expect(await startOnFork(c, child, onStarted)).toEqual({
      outcome: 'rejected',
      blockedBy: MANUAL_CLOSE_REFUSAL.branchNotOpen,
    })
    await expectNothingStartedOn(c.h, child, entries)
    expect(onStarted).not.toHaveBeenCalled()
  })
})
