/**
 * RetrievalPhase - Memory and lorebook retrieval
 * Runs timeline fill/agentic retrieval and lorebook entry retrieval in parallel
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  RetrievalResult,
  AbortedEvent,
  AgenticRetrievalFields,
} from '../types'
import type {
  StoryEntry,
  StoryMode,
  POV,
  Tense,
  Chapter,
  Entry,
  Character,
  Location,
  Item,
} from '$lib/types'
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type { RetrievalResult as AgenticServiceResult } from '$lib/services/ai/retrieval/AgenticRetrievalService'
import type {
  EntryRetrievalResult,
  ActivationTracker,
} from '$lib/services/ai/retrieval/EntryRetrievalService'
import { getEntryRetrievalConfigFromSettings } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { mapEntryRetrievalToLorebookEntries } from '$lib/services/context/lorebookMapper'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import { storyContext } from '$lib/stores/storyContext.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { DEFAULT_MEMORY_CONFIG } from '$lib/services/ai/generation/MemoryService'

/** Dependencies injected from AIService - phase calls these methods rather than duplicating logic */
export interface RetrievalDependencies {
  shouldUseAgenticRetrieval: (chaptersLength: number) => boolean
  runAgenticRetrieval: (
    userInput: string,
    recentEntries: StoryEntry[],
    chapters: Chapter[],
    entries: Entry[],
    onQueryChapter: (chapterNumber: number, question: string) => Promise<string>,
    onQueryChapters: (
      startChapter: number,
      endChapter: number,
      question: string,
    ) => Promise<string>,
    signal?: AbortSignal,
    mode?: StoryMode,
    pov?: POV,
    tense?: Tense,
  ) => Promise<AgenticServiceResult>
  runTimelineFill: (
    visibleEntries: StoryEntry[],
    chapters: Chapter[],
  ) => Promise<TimelineFillResult>
  answerChapterQuestion: (
    chapterNumber: number,
    question: string,
    chapters: Chapter[],
  ) => Promise<string>
  answerChapterRangeQuestion: (
    startChapter: number,
    endChapter: number,
    question: string,
    chapters: Chapter[],
  ) => Promise<string>
  getRelevantLorebookEntries: (
    entries: Entry[],
    userInput: string,
    recentStoryEntries: StoryEntry[],
    liveState: {
      characters: Character[]
      locations: Location[]
      items: Item[]
    },
    activationTracker?: ActivationTracker,
    signal?: AbortSignal,
  ) => Promise<EntryRetrievalResult>
}

export interface RetrievalInput {
  dependencies: RetrievalDependencies
}

export class RetrievalPhase {
  async *execute(input: RetrievalInput): AsyncGenerator<GenerationEvent, RetrievalResult> {
    yield { type: 'phase_start', phase: 'retrieval' } satisfies PhaseStartEvent

    const { dependencies } = input
    const timelineFillEnabled = settings.systemServicesSettings.timelineFill?.enabled ?? true
    const activationTracker = storyContext.activationTracker ?? undefined
    const visibleEntries = storyContext.visibleEntries
    const userAction = storyContext.userAction!
    const abortSignal = storyContext.abortSignal ?? undefined
    const chapters = storyContext.currentBranchChapters
    const lorebookEntries = storyContext.lorebookEntries
    const characters = storyContext.characters
    const locations = storyContext.locations
    const items = storyContext.items
    const memoryConfig = storyContext.currentStory?.memoryConfig ?? DEFAULT_MEMORY_CONFIG

    let agenticRetrieval: AgenticRetrievalFields | null = null
    let lorebookRetrievalResult: EntryRetrievalResult | null = null
    let timelineFillResult: TimelineFillResult | null = null

    const tasks: Promise<void>[] = []

    // Task 1: Memory retrieval (timeline fill or agentic)
    if (chapters.length > 0 && timelineFillEnabled && memoryConfig.enableRetrieval) {
      tasks.push(
        this.runMemoryRetrieval(input.dependencies)
          .then((result) => {
            agenticRetrieval = result.agenticRetrieval
            timelineFillResult = result.timelineFillResult
          })
          .catch((err) => {
            if (err instanceof Error && err.name === 'AbortError') return
            console.warn('[RetrievalPhase] Memory retrieval failed (non-fatal):', err)
          }),
      )
    }

    // Task 2: Lorebook entry retrieval (skip if agentic retrieval handles it)
    const useAgenticRetrieval = dependencies.shouldUseAgenticRetrieval(chapters.length)
    const hasLoreContent =
      lorebookEntries.length > 0 ||
      characters.length > 0 ||
      locations.length > 0 ||
      items.length > 0
    if (hasLoreContent && !useAgenticRetrieval) {
      tasks.push(
        dependencies
          .getRelevantLorebookEntries(
            lorebookEntries,
            userAction.content,
            visibleEntries.slice(-10),
            { characters, locations, items },
            activationTracker,
            abortSignal,
          )
          .then((result) => {
            lorebookRetrievalResult = result
          })
          .catch((err) => {
            if (err instanceof Error && err.name === 'AbortError') return
            console.warn('[RetrievalPhase] Lorebook retrieval failed (non-fatal):', err)
          }),
      )
    }

    if (tasks.length > 0) await Promise.all(tasks)

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'retrieval' } satisfies AbortedEvent
      return {
        agenticRetrieval: null,
        lorebookEntries: [],
        lorebookRetrievalResult: null,
        timelineFillResult: null,
      }
    }

    // Map raw retrieval result to typed ContextLorebookEntry[]
    const entryRetrievalConfig = getEntryRetrievalConfigFromSettings()
    const mappedLorebookEntries: ContextLorebookEntry[] = lorebookRetrievalResult
      ? mapEntryRetrievalToLorebookEntries(
          lorebookRetrievalResult,
          entryRetrievalConfig.maxWordsPerEntry,
        )
      : []

    const result: RetrievalResult = {
      agenticRetrieval,
      lorebookEntries: mappedLorebookEntries,
      lorebookRetrievalResult,
      timelineFillResult,
    }

    yield { type: 'phase_complete', phase: 'retrieval', result } satisfies PhaseCompleteEvent

    // Write result to singleton before returning
    storyContext.retrievalResult = result

    return result
  }

  private async runMemoryRetrieval(deps: RetrievalDependencies): Promise<{
    agenticRetrieval: AgenticRetrievalFields | null
    timelineFillResult: TimelineFillResult | null
  }> {
    const storyMode = storyContext.storyMode
    const pov = storyContext.pov
    const tense = storyContext.tense
    const visibleEntries = storyContext.visibleEntries
    const userAction = storyContext.userAction!
    const abortSignal = storyContext.abortSignal ?? undefined
    const chapters = storyContext.currentBranchChapters
    const lorebookEntries = storyContext.lorebookEntries

    if (deps.shouldUseAgenticRetrieval(chapters.length)) {
      const result = await deps.runAgenticRetrieval(
        userAction.content,
        visibleEntries,
        chapters,
        lorebookEntries,
        (num, q) => deps.answerChapterQuestion(num, q, chapters),
        (start, end, q) => deps.answerChapterRangeQuestion(start, end, q, chapters),
        abortSignal,
        storyMode,
        pov,
        tense,
      )
      const agenticRetrieval: AgenticRetrievalFields | null = result
        ? {
            agenticReasoning: result.agenticReasoning,
            agenticChapterSummary: result.agenticChapterSummary,
            agenticSelectedEntries: result.agenticSelectedEntries,
          }
        : null
      return {
        agenticRetrieval,
        timelineFillResult: null,
      }
    }

    return {
      agenticRetrieval: null,
      timelineFillResult: await deps.runTimelineFill(visibleEntries, chapters),
    }
  }
}
