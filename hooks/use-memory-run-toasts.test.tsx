// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema, type CloseReport } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  __resetBus,
  CHAPTER_CLOSE_KIND,
  definePipeline,
  PER_TURN_KIND,
  pipelineEventBus,
  startPipeline,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { openCloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  resetAllStores,
  type DeferredWorkKind,
  type StoreChapter,
} from '@/lib/stores'
import { toastStore, type ToastItem } from '@/lib/toast'

import { useMemoryRunToasts } from './use-memory-run-toasts'

type LatestReport = { chapterId: string; report: CloseReport | null } | null

const reads = vi.hoisted(() => ({
  latest: vi.fn<(db: unknown, branchId: string) => Promise<LatestReport>>(),
  real: undefined as ((db: never, branchId: string) => Promise<LatestReport>) | undefined,
}))

vi.mock('@/lib/history', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  reads.real = original.readLatestCloseReport as typeof reads.real
  return { ...original, readLatestCloseReport: reads.latest }
})

function Probe() {
  useMemoryRunToasts()
  return null
}

function deferred(work: DeferredWorkKind, kind: string): void {
  pipelineEventBus.emit({
    type: 'run_deferred',
    runId: `run-${kind}`,
    kind,
    branchId: 'branch-1',
    work,
  })
}

function ended(
  outcome: 'completed' | 'aborted' | 'failed',
  over: { kind?: string; beforeTurn?: boolean } = {},
): void {
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: 'run-pass',
    kind: over.kind ?? PERIODIC_CLASSIFIER_KIND,
    actionId: 'act-pass',
    beforeTurn: over.beforeTurn ?? false,
    outcome,
    ...(outcome === 'failed'
      ? { error: { kind: 'provider', reason: 'timeout', detail: 'classifier: timeout' } as const }
      : {}),
  })
}

function committed(actionId: string, beforeTurn = false): void {
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: 'run-close',
    kind: CHAPTER_CLOSE_KIND,
    actionId,
    beforeTurn,
    outcome: 'completed',
  })
}

function report(actionId: string, stopped: CloseReport['stopped'] = []): CloseReport {
  return { version: 1, actionId, calls: [], stopped, noToolCalls: true }
}

function openStory(branchId = 'br_1'): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId,
    definition: storyDefinitionSchema.parse({
      mode: 'adventure',
      leadEntityId: 'char_kael',
      narration: 'second',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
      calendarSystemId: 'gregorian',
      worldTimeOrigin: { year: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

function chapter(id: string, sequenceNumber: number): StoreChapter {
  return {
    id,
    branchId: 'br_1',
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: `entry_${sequenceNumber}_start`,
    endEntryId: `entry_${sequenceNumber}_end`,
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: true,
  }
}

// Lets a read the handler awaits resolve before asserting it held nothing.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const held = () => chapterOverlaysStore.getState().closeResult

describe('useMemoryRunToasts', () => {
  let shown: ToastItem[] = []

  beforeEach(() => {
    __resetBus()
    resetAllStores()
    toastStore.__reset()
    toastStore.subscribe((items) => {
      shown = items
    })
    reads.latest.mockReset()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('toasts a deferred pass once, as info with no action', () => {
    render(<Probe />)
    deferred('pass', PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Memory update moved to your next turn.',
      }),
    ])
    expect(shown[0]).not.toHaveProperty('action')
  })

  it('toasts a deferred chapter close with its own copy', () => {
    render(<Probe />)
    deferred('close', 'chapter-close')
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Chapter close moved to your next turn.',
      }),
    ])
  })

  it('picks the copy from the deferred slot, not the run kind', () => {
    render(<Probe />)
    deferred('close', PERIODIC_CLASSIFIER_KIND)
    expect(shown).toEqual([
      expect.objectContaining({ message: 'Chapter close moved to your next turn.' }),
    ])
  })

  it('warns once when a pass outside a Send fails, with no action', () => {
    render(<Probe />)
    ended('failed')
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Memory update failed. It runs again before your next turn.',
      }),
    ])
    expect(shown[0]).not.toHaveProperty('action')
  })

  // A pass that fails at Send fails the Send, which the reader's system entry reports.
  it('stays quiet for a pass that fails before a turn', () => {
    render(<Probe />)
    ended('failed', { beforeTurn: true })
    expect(shown).toEqual([])
  })

  it('stays quiet for a pass that commits or is cancelled', () => {
    render(<Probe />)
    ended('completed')
    ended('aborted')
    expect(shown).toEqual([])
  })

  it("stays quiet for another kind's failure", () => {
    render(<Probe />)
    ended('failed', { kind: PER_TURN_KIND })
    expect(shown).toEqual([])
  })

  it('warns once when a chapter close outside a Send fails, with no action', () => {
    render(<Probe />)
    ended('failed', { kind: CHAPTER_CLOSE_KIND })
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Chapter close failed. It runs again before your next turn.',
      }),
    ])
    expect(shown[0]).not.toHaveProperty('action')
  })

  // A close that fails at Send fails the Send, which the reader's system entry reports.
  it('stays quiet for a chapter close that fails before a turn', () => {
    render(<Probe />)
    ended('failed', { kind: CHAPTER_CLOSE_KIND, beforeTurn: true })
    expect(shown).toEqual([])
  })

  it('shows only the deferral for a cancelled chapter close', () => {
    render(<Probe />)
    ended('aborted', { kind: CHAPTER_CLOSE_KIND })
    deferred('close', CHAPTER_CLOSE_KIND)
    expect(shown).toEqual([
      expect.objectContaining({
        severity: 'info',
        message: 'Chapter close moved to your next turn.',
      }),
    ])
  })

  it('stops toasting once unmounted', () => {
    openStory()
    const { unmount } = render(<Probe />)
    unmount()
    deferred('pass', PERIODIC_CLASSIFIER_KIND)
    ended('failed')
    ended('failed', { kind: CHAPTER_CLOSE_KIND })
    committed('act_close')
    expect(shown).toEqual([])
    expect(reads.latest).not.toHaveBeenCalled()
  })

  describe("a committed close's banner", () => {
    it('holds the close for the banner, with no toast', async () => {
      openStory()
      reads.latest.mockResolvedValue({ chapterId: 'chap_2', report: report('act_close') })
      render(<Probe />)
      committed('act_close')
      await vi.waitFor(() =>
        expect(held()).toEqual({ branchId: 'br_1', chapterId: 'chap_2', stoppedTasks: 0 }),
      )
      expect(reads.latest).toHaveBeenCalledWith(expect.anything(), 'br_1')
      expect(shown).toEqual([])
    })

    it('counts the tasks that stopped early', async () => {
      openStory()
      reads.latest.mockResolvedValue({
        chapterId: 'chap_2',
        report: report('act_close', [
          { task: 'identity', part: 1, reason: 'budget' },
          { task: 'lore', part: 2, reason: 'window' },
        ]),
      })
      render(<Probe />)
      committed('act_close')
      await vi.waitFor(() => expect(held()?.stoppedTasks).toBe(2))
    })

    it.each([true, false])('holds it with beforeTurn %s', async (beforeTurn) => {
      openStory()
      reads.latest.mockResolvedValue({ chapterId: 'chap_2', report: report('act_close') })
      render(<Probe />)
      committed('act_close', beforeTurn)
      await vi.waitFor(() => expect(held()?.chapterId).toBe('chap_2'))
    })

    it('holds nothing for a report another close wrote', async () => {
      openStory()
      reads.latest.mockResolvedValue({ chapterId: 'chap_2', report: report('act_other') })
      render(<Probe />)
      committed('act_close')
      await vi.waitFor(() => expect(reads.latest).toHaveBeenCalledTimes(1))
      await flush()
      expect(held()).toBeNull()
    })

    it('holds nothing when the latest chapter has no report, or the branch no chapter', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      openStory()
      chaptersStore.hydrate('br_1', [chapter('chap_1', 1), chapter('chap_2', 2)])
      reads.latest
        .mockResolvedValueOnce({ chapterId: 'chap_2', report: null })
        .mockResolvedValueOnce(null)
      render(<Probe />)
      committed('act_close')
      committed('act_close')
      await vi.waitFor(() => expect(reads.latest).toHaveBeenCalledTimes(2))
      await flush()
      expect(held()).toBeNull()
      expect(warn).not.toHaveBeenCalled()
    })

    it('reads nothing for a pass or another kind that completes', async () => {
      openStory()
      render(<Probe />)
      ended('completed')
      ended('completed', { kind: PER_TURN_KIND })
      await flush()
      expect(reads.latest).not.toHaveBeenCalled()
      expect(held()).toBeNull()
    })

    it('reads nothing for an aborted or failed close', async () => {
      openStory()
      render(<Probe />)
      ended('aborted', { kind: CHAPTER_CLOSE_KIND })
      ended('failed', { kind: CHAPTER_CLOSE_KIND })
      await flush()
      expect(reads.latest).not.toHaveBeenCalled()
      expect(held()).toBeNull()
    })

    it('reads nothing while no story is open', async () => {
      render(<Probe />)
      committed('act_close')
      await flush()
      expect(reads.latest).not.toHaveBeenCalled()
      expect(held()).toBeNull()
    })

    it('logs a failed read and holds the latest chapter in the store, with no count', async () => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
      openStory()
      chaptersStore.hydrate('br_1', [
        chapter('chap_1', 1),
        chapter('chap_2', 2),
        chapter('chap_0', 0),
      ])
      reads.latest.mockRejectedValue(new Error('disk'))
      render(<Probe />)
      committed('act_close')
      await vi.waitFor(() =>
        expect(held()).toEqual({ branchId: 'br_1', chapterId: 'chap_2', stoppedTasks: 0 }),
      )
      expect(warn).toHaveBeenCalledWith('app.close_result_read_failed', {
        branchId: 'br_1',
        actionId: 'act_close',
        error: 'disk',
      })
    })

    it('holds nothing on a failed read when the store holds another branch', async () => {
      vi.spyOn(logger, 'warn').mockImplementation(() => {})
      openStory()
      chaptersStore.hydrate('br_2', [chapter('chap_9', 1)])
      reads.latest.mockRejectedValue(new Error('disk'))
      render(<Probe />)
      committed('act_close')
      await vi.waitFor(() => expect(reads.latest).toHaveBeenCalledTimes(1))
      await flush()
      expect(held()).toBeNull()
    })

    it('a newer close replaces the held one', async () => {
      openStory()
      reads.latest
        .mockResolvedValueOnce({ chapterId: 'chap_2', report: report('act_close_2') })
        .mockResolvedValueOnce({ chapterId: 'chap_3', report: report('act_close_3') })
      render(<Probe />)
      committed('act_close_2')
      await vi.waitFor(() => expect(held()?.chapterId).toBe('chap_2'))
      committed('act_close_3')
      await vi.waitFor(() => expect(held()?.chapterId).toBe('chap_3'))
    })

    it('holds nothing when it unmounts with the read in flight', async () => {
      openStory()
      let resolveRead!: (value: { chapterId: string; report: CloseReport }) => void
      reads.latest.mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve
        }),
      )
      const { unmount } = render(<Probe />)
      committed('act_close')
      await vi.waitFor(() => expect(reads.latest).toHaveBeenCalledTimes(1))
      unmount()
      resolveRead({ chapterId: 'chap_2', report: report('act_close') })
      await flush()
      expect(held()).toBeNull()
    })
  })

  // Through the orchestrator, so the close's beforeTurn is the one its predecessor hands down.
  describe('a close chained after a pass', () => {
    beforeEach(() => {
      resetSingletons()
    })
    afterEach(() => {
      resetSingletons()
    })

    async function* commits(): AsyncGenerator<never, PhaseResult> {
      return { status: 'completed' }
    }

    async function* fails(): AsyncGenerator<never, PhaseResult> {
      return { status: 'failed', error: { kind: 'phase-logic', detail: 'stand-in close failed' } }
    }

    it('stays quiet under a Send and warns outside one', async () => {
      const { ctx } = await makeHarness()
      definePipeline({
        kind: CHAPTER_CLOSE_KIND,
        phases: [{ name: 'boundary', run: fails }],
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: 'close',
        concurrencyPolicy: {},
      })
      definePipeline({
        kind: PERIODIC_CLASSIFIER_KIND,
        phases: [{ name: 'classify', run: commits }],
        chainsTo: () => CHAPTER_CLOSE_KIND,
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: 'pass',
        concurrencyPolicy: {},
      })
      render(<Probe />)

      await startPipeline(PERIODIC_CLASSIFIER_KIND, { ...ctx, beforeTurn: true }).chain
      expect(shown).toEqual([])

      await startPipeline(PERIODIC_CLASSIFIER_KIND, ctx).chain
      expect(shown).toEqual([
        expect.objectContaining({
          severity: 'warning',
          message: 'Chapter close failed. It runs again before your next turn.',
        }),
      ])
    })

    it('holds a close that commits under a Send for the banner', async () => {
      const { ctx } = await makeHarness()
      let closeActionId = ''
      pipelineEventBus.subscribe('run_start', (event) => {
        if (event.kind === CHAPTER_CLOSE_KIND) closeActionId = event.actionId
      })
      reads.latest.mockImplementation(async () => ({
        chapterId: 'chap_2',
        report: report(closeActionId),
      }))
      definePipeline({
        kind: CHAPTER_CLOSE_KIND,
        phases: [{ name: 'boundary', run: commits }],
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: 'close',
        concurrencyPolicy: {},
      })
      definePipeline({
        kind: PERIODIC_CLASSIFIER_KIND,
        phases: [{ name: 'classify', run: commits }],
        chainsTo: () => CHAPTER_CLOSE_KIND,
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: 'pass',
        concurrencyPolicy: {},
      })
      openStory('b1')
      render(<Probe />)

      await startPipeline(PERIODIC_CLASSIFIER_KIND, { ...ctx, beforeTurn: true }).chain

      await vi.waitFor(() =>
        expect(chapterOverlaysStore.getState().closeResult).toEqual({
          branchId: 'b1',
          chapterId: 'chap_2',
          stoppedTasks: 0,
        }),
      )
      expect(closeActionId).not.toBe('')
      expect(reads.latest).toHaveBeenCalledWith(expect.anything(), 'b1')
      expect(shown).toEqual([])
    })

    // The prune keeps a result only while its chapter's store row carries hasCloseReport, so the
    // result must be held after the report phase's delta has patched chaptersStore.
    it("holds a close's result only once the store row carries its report", async () => {
      const fx = await openCloseFixture()
      const chapterId = 'chap_77777777-7777-4777-8777-777777777777'
      const startEntryId = fx.entries[0]!.id
      const endEntryId = fx.replyIds[0]!
      const stoppedLore = { task: 'lore', part: 1, reason: 'budget' } as const

      async function* writesChapter(ctx: {
        actionId: string
      }): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
        const now = Date.now()
        yield {
          type: 'delta_emitted',
          action: {
            kind: 'createChapter',
            source: 'chapter_close',
            payload: {
              entry: {
                id: chapterId,
                branchId: fx.branchId,
                sequenceNumber: 1,
                title: 'The Crossing',
                summary: '',
                theme: '',
                keywords: [],
                startEntryId,
                endEntryId,
                tokenCount: 0,
                closedAt: now,
                createdAt: now,
                updatedAt: now,
              },
            },
          },
          entryId: endEntryId,
        }
        yield {
          type: 'delta_emitted',
          action: {
            kind: 'updateChapter',
            source: 'chapter_close',
            payload: {
              branchId: fx.branchId,
              id: chapterId,
              patch: { closeReport: report(ctx.actionId, [stoppedLore]) },
            },
          },
          entryId: endEntryId,
        }
        return { status: 'completed' }
      }

      definePipeline({
        kind: CHAPTER_CLOSE_KIND,
        phases: [{ name: 'report', run: writesChapter }],
        affordance: 'pill-and-banner',
        gateBehavior: 'hard-gate',
        interruptible: 'close',
        concurrencyPolicy: {},
      })
      reads.latest.mockImplementation((_db, branchId) => reads.real!(fx.ctx.db as never, branchId))
      const storeHadReport: (boolean | undefined)[] = []
      const show = chapterOverlaysStore.showCloseResult
      vi.spyOn(chapterOverlaysStore, 'showCloseResult').mockImplementation((result) => {
        storeHadReport.push(chaptersStore.getById(result.chapterId)?.hasCloseReport)
        show(result)
      })
      render(<Probe />)

      await startPipeline(CHAPTER_CLOSE_KIND, {
        storyId: fx.storyId,
        branchId: fx.branchId,
        ...fx.ctx,
      }).chain

      await vi.waitFor(() =>
        expect(held()).toEqual({ branchId: fx.branchId, chapterId, stoppedTasks: 1 }),
      )
      expect(storeHadReport).toEqual([true])
      expect(chaptersStore.getById(chapterId)?.hasCloseReport).toBe(true)
    })
  })
})
