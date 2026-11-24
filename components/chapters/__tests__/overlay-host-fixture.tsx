import { QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'

import { createQueryClient } from '@/lib/cache'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema } from '@/lib/db'
import {
  chapterOverlaysStore,
  currentStoryStore,
  generationStore,
  type OpenStory,
  type RunState,
  type StoreChapter,
} from '@/lib/stores'

import { ChapterOverlaysHost } from '../chapter-overlays-host'

export function story(branchId: string): OpenStory {
  return {
    storyId: 'story_1',
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
  }
}

// A branch switch or reload republishes the open; it isn't a new open of the story.
export function openStory(branchId = 'br_1'): void {
  currentStoryStore.set(story(branchId))
}

function turnRun(name: string): RunState {
  return {
    runId: `run_${name}`,
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `act_${name}`,
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

/** A turn on `br_1` that starts and settles, bumping its settle count. */
export function settleRun(): void {
  const run = turnRun('settle')
  act(() => generationStore.startRun(run))
  act(() => generationStore.finishRun(run.runId))
}

/** A hard-gate turn on `br_1`, for the caller to start and finish. */
export function gateRun(): RunState {
  return turnRun('gate')
}

export function renderHost() {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ChapterOverlaysHost />
    </QueryClientProvider>,
  )
}

export function openWindow(chapterId = 'chap_2', branchId = 'br_1'): void {
  act(() => chapterOverlaysStore.openReviewWindow({ branchId, chapterId }))
}

export function openRerun(input: { fromReview?: boolean } = {}): void {
  act(() =>
    chapterOverlaysStore.openRerunConfirm({ branchId: 'br_1', chapterId: 'chap_2', ...input }),
  )
}

export const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

// The action alone keeps the default report; a row without one drops both.
export type ChapterOverrides = Partial<
  Omit<StoreChapter, 'hasCloseReport' | 'closeReportActionId'>
> &
  (
    | { hasCloseReport?: true; closeReportActionId?: string }
    | { hasCloseReport: false; closeReportActionId: null }
  )

export function chapter(over: ChapterOverrides = {}): StoreChapter {
  return {
    id: 'chap_2',
    branchId: 'br_1',
    sequenceNumber: 2,
    title: 'The Keep Leans Closer',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: 'entry_40',
    endEntryId: 'entry_58',
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 0,
    createdAt: 1,
    updatedAt: 1,
    hasCloseReport: true,
    closeReportActionId: 'act_close_2',
    ...over,
  }
}
