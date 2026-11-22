// @vitest-environment jsdom
import { act, cleanup, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type OpenRegionRow } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { PipelineError } from '@/lib/pipeline'
import {
  chapterOverlaysStore,
  chaptersStore,
  currentStoryStore,
  generationStore,
  resetAllStores,
} from '@/lib/stores'
import { toast } from '@/lib/toast'

import {
  chapter,
  gateRun,
  openStory,
  renderHost,
  settleRun,
  story,
} from './__tests__/overlay-host-fixture'
import type { CloseChapterModalViewProps } from './close-chapter-modal-view'

const reads = vi.hoisted(() => ({ series: vi.fn(), times: vi.fn() }))

// The runtime `db` is a bridge client; the host only passes it to the mocked reads.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  openRegionSeries: reads.series,
}))

vi.mock('@/lib/entry-refs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readOpenRegionTimes: reads.times,
}))

const actions = vi.hoisted(() => ({ start: vi.fn(), raise: vi.fn() }))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  startManualClose: actions.start,
  raiseSystemEntry: actions.raise,
}))

// The close-failure copy's module also holds a hook on expo-router, which the unit project can't load.
vi.mock('expo-router', () => ({ useRouter: () => ({}) }))

vi.mock('@/hooks/use-surface-navigate', () => ({ useSurfaceNavigate: () => vi.fn() }))

const entryIndex = vi.hoisted(() => ({ index: new Map<string, EntryRef>() }))
vi.mock('@/hooks/use-entry-index', () => ({
  useEntryIndex: () => ({
    entries: [],
    index: entryIndex.index,
    ready: true,
    failed: false,
    updating: false,
    retry: () => {},
  }),
}))

// The real views pull RN-Web chrome the unit project can't load; the host's props are the seam.
vi.mock('./review-window', () => ({ ReviewWindow: () => null }))
vi.mock('./close-rerun-confirm', () => ({ CloseRerunConfirm: () => null }))

const modalView = vi.hoisted(() => ({
  props: null as CloseChapterModalViewProps | null,
  mounted: false,
  // What each render showed, so a test can see a frame that dropped the rows or their times.
  frames: [] as { replies: number; startTime: string | null }[],
}))
vi.mock('./close-chapter-modal-view', async () => {
  const { useEffect } = await import('react')
  return {
    CloseChapterModalView: (props: CloseChapterModalViewProps) => {
      modalView.props = props
      modalView.frames.push({ replies: props.replies.length, startTime: props.start?.time ?? null })
      useEffect(() => {
        modalView.mounted = true
        return () => {
          modalView.mounted = false
        }
      }, [])
      return null
    },
  }
})

// The open region after chapter 2: three turns; running totals 420, 720, 1000.
const SERIES: readonly OpenRegionRow[] = [
  { id: 'entry_59', kind: 'user_action', position: 59, tokens: 120 },
  { id: 'entry_60', kind: 'ai_reply', position: 60, tokens: 300 },
  { id: 'entry_61', kind: 'user_action', position: 61, tokens: 40 },
  { id: 'entry_62', kind: 'ai_reply', position: 62, tokens: 260 },
  { id: 'entry_63', kind: 'user_action', position: 63, tokens: 30 },
  { id: 'entry_64', kind: 'ai_reply', position: 64, tokens: 250 },
]

// Only entry_59 and entry_62 carry a world time.
const TIMES: ReadonlyMap<string, number> = new Map([
  ['entry_59', 3_600],
  ['entry_62', 7_200],
])

const EXCERPTS: Record<string, string> = {
  entry_59: 'I tie the mare outside the inn.',
  entry_60: 'The inn is warm and loud with drovers.',
  entry_61: 'I ask whether the ferry runs at night.',
  entry_62: 'She shrugs: the ferry runs when Tobin says it runs.',
  entry_63: 'I go down to the landing.',
  entry_64: 'The landing is a black line of planks over black water.',
}

const MODAL_INDEX = new Map<string, EntryRef>(
  SERIES.map((row) => [
    row.id,
    {
      id: row.id,
      position: row.position,
      kind: row.kind,
      chapterId: null,
      excerpt: EXCERPTS[row.id]!,
    },
  ]),
)

// Midnight, 1 January 2024: 3,600 s renders as 01:00 that day.
const ORIGIN_2024 = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

const TOOL_OFF: PipelineError = {
  kind: 'config-resolver',
  failure: 'tool-calling-off',
  target: 'lore-mgmt',
  phaseName: 'agent',
  modelId: 'gemma-4-26b',
}

beforeEach(() => {
  resetAllStores()
  reads.series.mockReset().mockResolvedValue(SERIES)
  reads.times.mockReset().mockResolvedValue(TIMES)
  actions.start.mockReset()
  actions.raise.mockReset().mockResolvedValue('sys_1')
  modalView.props = null
  modalView.mounted = false
  modalView.frames = []
  openStory()
  chaptersStore.hydrate('br_1', [chapter()])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChapterOverlaysHost — the close modal', () => {
  beforeEach(() => {
    const open = story('br_1')
    currentStoryStore.set({
      ...open,
      definition: {
        ...open.definition,
        calendarSystemId: 'earth-gregorian',
        worldTimeOrigin: ORIGIN_2024,
      },
    })
    entryIndex.index = MODAL_INDEX
  })

  const openModal = (request: { branchId: string; endEntryId?: string } = { branchId: 'br_1' }) =>
    act(() => chapterOverlaysStore.openCloseModal(request))

  // Both reads landed: the series gives the replies, the times the start row's label.
  async function shownModal(): Promise<CloseChapterModalViewProps> {
    await waitFor(() => expect(modalView.props?.replies).toHaveLength(3))
    await waitFor(() => expect(modalView.props?.start?.time).toBe('January 1, 2024 AD 01:00'))
    return modalView.props!
  }

  async function confirmLatest(): Promise<void> {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onConfirm())
  }

  it('mounts no body, and reads nothing, while no request is held', () => {
    renderHost()
    expect(modalView.mounted).toBe(false)
    expect(reads.series).not.toHaveBeenCalled()
    expect(reads.times).not.toHaveBeenCalled()
  })

  it('shows the region from its first entry, its replies newest first, the latest picked', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    expect(props.open).toBe(true)
    expect(props.start).toEqual({
      id: 'entry_59',
      ref: 'entry #59',
      excerpt: EXCERPTS.entry_59,
      time: 'January 1, 2024 AD 01:00',
      endedChapterNumber: 2,
    })
    expect(props.replies).toEqual([
      { id: 'entry_64', ref: 'entry #64', excerpt: EXCERPTS.entry_64, time: null },
      {
        id: 'entry_62',
        ref: 'entry #62',
        excerpt: EXCERPTS.entry_62,
        time: 'January 1, 2024 AD 02:00',
      },
      { id: 'entry_60', ref: 'entry #60', excerpt: EXCERPTS.entry_60, time: null },
    ])
    expect(props.selectedId).toBe('entry_64')
    expect(props.tokensInRange).toBe(1000)
    expect(props.disabledReason).toBeUndefined()
    expect(reads.series).toHaveBeenCalledWith('br_1', { db: {} })
    expect(reads.times).toHaveBeenCalledWith('br_1', {})
  })

  it('opens on the end entry passed while it is one of the replies', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_62' })
    const props = await shownModal()
    expect(props.selectedId).toBe('entry_62')
    expect(props.tokensInRange).toBe(720)
  })

  it('opens on the latest reply when the end passed is not one', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_61' })
    expect((await shownModal()).selectedId).toBe('entry_64')
  })

  it('moves the selection and its count with a pick', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    expect(modalView.props?.selectedId).toBe('entry_60')
    expect(modalView.props?.tokensInRange).toBe(420)
  })

  it('holds a pick over the end entry passed', async () => {
    renderHost()
    openModal({ branchId: 'br_1', endEntryId: 'entry_62' })
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    expect(modalView.props?.selectedId).toBe('entry_60')
    expect(modalView.props?.tokensInRange).toBe(420)
  })

  // A close ending on entry_60 settled while the modal was up: the pick left the region.
  it('falls back to the latest reply once the pick is no longer one', async () => {
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    reads.series.mockResolvedValue(SERIES.slice(2))
    settleRun()
    await waitFor(() => expect(modalView.props?.replies).toHaveLength(2))
    expect(modalView.props?.selectedId).toBe('entry_64')
    expect(modalView.props?.tokensInRange).toBe(580)
  })

  it('tags no chapter on a branch with none closed', async () => {
    chaptersStore.hydrate('br_1', [])
    renderHost()
    openModal()
    expect((await shownModal()).start?.endedChapterNumber).toBeNull()
  })

  it("tags no chapter from another branch's rows still held", async () => {
    chaptersStore.hydrate('br_2', [chapter({ id: 'chap_9', branchId: 'br_2', sequenceNumber: 9 })])
    renderHost()
    openModal()
    expect((await shownModal()).start?.endedChapterNumber).toBeNull()
  })

  it("disables Close chapter with the gate's reason while a run holds it, and enables it after", async () => {
    renderHost()
    openModal()
    await shownModal()
    modalView.frames = []
    const run = gateRun()
    act(() => generationStore.startRun(run))
    await waitFor(() => expect(modalView.props?.disabledReason).toBe(t('generationGate.inFlight')))
    act(() => generationStore.finishRun(run.runId))
    await waitFor(() => expect(modalView.props?.disabledReason).toBeUndefined())
    // The settle re-reads both under a new key; the rows stay up meanwhile.
    await waitFor(() => expect(reads.series).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(reads.times).toHaveBeenCalledTimes(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(modalView.frames).not.toContainEqual(expect.objectContaining({ replies: 0 }))
    expect(modalView.frames).not.toContainEqual(expect.objectContaining({ startTime: null }))
  })

  // C15: a world-time edit moves neither settleCount nor the tail, and the client never goes stale.
  it('reads the world times again each time it opens', async () => {
    renderHost()
    openModal()
    await shownModal()
    act(() => modalView.props!.onCancel())
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    openModal()
    await waitFor(() => expect(reads.times).toHaveBeenCalledTimes(2))
    expect(reads.series).toHaveBeenCalledTimes(1)
  })

  it('logs a failed region read as an error and offers nothing to confirm', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.series.mockRejectedValue(new Error('disk'))
    renderHost()
    openModal()
    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('app.close_modal_read_failed', {
        branchId: 'br_1',
        read: 'series',
        error: 'disk',
      }),
    )
    expect(warn).not.toHaveBeenCalled()
    expect(modalView.props).toMatchObject({
      start: null,
      replies: [],
      selectedId: null,
      tokensInRange: 0,
    })
    act(() => modalView.props!.onConfirm())
    expect(actions.start).not.toHaveBeenCalled()
  })

  it('logs a failed world-time read as a warning and still offers the replies', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.times.mockRejectedValue(new Error('disk'))
    renderHost()
    openModal()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('app.close_modal_read_failed', {
        branchId: 'br_1',
        read: 'times',
        error: 'disk',
      }),
    )
    expect(error).not.toHaveBeenCalled()
    await waitFor(() => expect(modalView.props?.replies).toHaveLength(3))
    expect(modalView.props?.selectedId).toBe('entry_64')
  })

  // AC11's host half: the request belongs to the branch it was made on.
  it('clears the request when the open branch moves, and shows it on neither branch', async () => {
    renderHost()
    openModal()
    await shownModal()
    modalView.props = null
    act(() => openStory('br_2'))
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    act(() => openStory('br_1'))
    expect(modalView.mounted).toBe(false)
    // Not a frame of the request on br_2's open.
    expect(modalView.props).toBeNull()
  })

  it('drops a request for a branch the open story does not show', () => {
    renderHost()
    openModal({ branchId: 'br_2' })
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    // Never rendered, even for the frame before the drop.
    expect(modalView.props).toBeNull()
    expect(reads.series).not.toHaveBeenCalled()
  })

  it('shuts the modal at once on confirm, and starts the close on the selected end', async () => {
    // A close runs under the banner for minutes; the modal doesn't wait for it.
    actions.start.mockReturnValue(new Promise(() => {}))
    await confirmLatest()
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(modalView.mounted).toBe(false)
    expect(actions.start).toHaveBeenCalledWith('br_1', 'entry_64', {
      db: {},
      runInTransaction: expect.any(Function),
    })
  })

  it('starts the close on the picked end, not the latest', async () => {
    actions.start.mockReturnValue(new Promise(() => {}))
    renderHost()
    openModal()
    const props = await shownModal()
    act(() => props.onSelect('entry_60'))
    expect(modalView.props?.selectedId).toBe('entry_60')
    act(() => modalView.props!.onConfirm())
    expect(chapterOverlaysStore.getState().closeModal).toBeNull()
    expect(actions.start).toHaveBeenCalledExactlyOnceWith('br_1', 'entry_60', {
      db: {},
      runInTransaction: expect.any(Function),
    })
  })

  // AC9's host half.
  it('writes the entry and toasts for a failed pre-flight', async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'preflight-failed', error: TOOL_OFF })
    await confirmLatest()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(t('chapters:closeModal.toast.preflightFailed')),
    )
    expect(actions.raise).toHaveBeenCalledWith(
      {
        branchId: 'br_1',
        content: expect.stringContaining('gemma-4-26b'),
        failure: expect.objectContaining({ kind: 'config-resolver', closePick: 'entry_64' }),
      },
      { db: {}, runInTransaction: expect.any(Function) },
    )
  })

  it('only toasts for a refused start', async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'rejected', blockedBy: 'story-busy' })
    await confirmLatest()
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(t('reader:actions.blockedWhileGenerating')),
    )
    expect(actions.raise).not.toHaveBeenCalled()
  })

  it("does neither for a run's result", async () => {
    const warn = vi.spyOn(toast, 'warning').mockReturnValue('')
    actions.start.mockResolvedValue({ outcome: 'completed', runId: 'run_1', actionId: 'act_1' })
    await confirmLatest()
    await waitFor(() => expect(actions.start).toHaveBeenCalledOnce())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(warn).not.toHaveBeenCalled()
    expect(actions.raise).not.toHaveBeenCalled()
  })
})
