/**
 * RetrievalPhase - Memory and lorebook retrieval
 * Runs timeline fill/agentic retrieval and lorebook entry retrieval in parallel
 */

import type {
  GenerationContext,
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  RetrievalResult,
  AbortedEvent,
} from '../types'
import type { StoryMode, POV, Tense } from '$lib/types'
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type { AgenticRetrievalResult } from '$lib/services/ai/retrieval/AgenticRetrievalService'
import type {
  EntryRetrievalResult,
  ActivationTracker,
} from '$lib/services/ai/retrieval/EntryRetrievalService'

/** Dependencies injected from AIService - phase calls these methods rather than duplicating logic */
export interface RetrievalDependencies {
  shouldUseAgenticRetrieval: (chaptersLength: number) => boolean
  runAgenticRetrieval: (
    userInput: string,
    recentEntries: GenerationContext['visibleEntries'],
    chapters: GenerationContext['worldState']['chapters'],
    entries: GenerationContext['worldState']['lorebookEntries'],
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
  ) => Promise<AgenticRetrievalResult>
  formatAgenticRetrievalForPrompt: (result: AgenticRetrievalResult) => string
  runTimelineFill: (
    visibleEntries: GenerationContext['visibleEntries'],
    chapters: GenerationContext['worldState']['chapters'],
  ) => Promise<TimelineFillResult>
  answerChapterQuestion: (
    chapterNumber: number,
    question: string,
    chapters: GenerationContext['worldState']['chapters'],
  ) => Promise<string>
  answerChapterRangeQuestion: (
    startChapter: number,
    endChapter: number,
    question: string,
    chapters: GenerationContext['worldState']['chapters'],
  ) => Promise<string>
  getRelevantLorebookEntries: (
    entries: GenerationContext['worldState']['lorebookEntries'],
    userInput: string,
    recentStoryEntries: GenerationContext['visibleEntries'],
    liveState: {
      characters: GenerationContext['worldState']['characters']
      locations: GenerationContext['worldState']['locations']
      items: GenerationContext['worldState']['items']
    },
    activationTracker?: ActivationTracker,
    signal?: AbortSignal,
  ) => Promise<EntryRetrievalResult>
}

export interface RetrievalInput {
  context: GenerationContext
  dependencies: RetrievalDependencies
  timelineFillEnabled: boolean
  activationTracker?: ActivationTracker
  storyMode: StoryMode
  pov?: POV
  tense?: Tense
}

export class RetrievalPhase {
  async *execute(input: RetrievalInput): AsyncGenerator<GenerationEvent, RetrievalResult> {
    yield { type: 'phase_start', phase: 'retrieval' } satisfies PhaseStartEvent

    const { context, dependencies, timelineFillEnabled, activationTracker } = input
    const { worldState, visibleEntries, userAction, abortSignal } = context
    const { chapters, lorebookEntries, characters, locations, items, memoryConfig } = worldState

    let chapterContext: string | null = null
    let lorebookContext: string | null = null
    let lorebookRetrievalResult: EntryRetrievalResult | null = null
    let timelineFillResult: TimelineFillResult | null = null

    const tasks: Promise<void>[] = []

    // Task 1: Memory retrieval (timeline fill or agentic)
    if (chapters.length > 0 && timelineFillEnabled && memoryConfig.enableRetrieval) {
      tasks.push(
        this.runMemoryRetrieval(input)
          .then((result) => {
            chapterContext = result.chapterContext
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
            lorebookContext = result.contextBlock
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
        chapterContext: null,
        lorebookContext: null,
        lorebookRetrievalResult: null,
        timelineFillResult: null,
        combinedContext: null,
      }
    }

    const combinedContext = [chapterContext, lorebookContext].filter(Boolean).join('\n') || null
    const result: RetrievalResult = {
      chapterContext,
      lorebookContext,
      lorebookRetrievalResult,
      timelineFillResult,
      combinedContext,
    }

    yield { type: 'phase_complete', phase: 'retrieval', result } satisfies PhaseCompleteEvent
    return result
  }

  private async runMemoryRetrieval(input: RetrievalInput): Promise<{
    chapterContext: string | null
    timelineFillResult: TimelineFillResult | null
  }> {
    const { context, dependencies, storyMode, pov, tense } = input
    const { worldState, visibleEntries, userAction, abortSignal } = context
    const { chapters, lorebookEntries } = worldState

    if (dependencies.shouldUseAgenticRetrieval(chapters.length)) {
      const result = await dependencies.runAgenticRetrieval(
        userAction.content,
        visibleEntries,
        chapters,
        lorebookEntries,
        (num, q) => dependencies.answerChapterQuestion(num, q, chapters),
        (start, end, q) => dependencies.answerChapterRangeQuestion(start, end, q, chapters),
        abortSignal,
        storyMode,
        pov,
        tense,
      )
      return {
        chapterContext: result.context
          ? dependencies.formatAgenticRetrievalForPrompt(result)
          : null,
        timelineFillResult: null,
      }
    }

    return {
      chapterContext: null,
      timelineFillResult: await dependencies.runTimelineFill(visibleEntries, chapters),
    }
  }
}
