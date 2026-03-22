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
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type { EntryRetrievalResult } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { getEntryRetrievalConfigFromSettings } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { mapEntryRetrievalToLorebookEntries } from '$lib/services/context/lorebookMapper'
import type { ContextLorebookEntry } from '$lib/services/context/context-types'
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService } from '$lib/services/ai'

export class RetrievalPhase {
  async *execute(): AsyncGenerator<GenerationEvent, boolean> {
    yield { type: 'phase_start', phase: 'retrieval' } satisfies PhaseStartEvent

    const timelineFillEnabled = settings.systemServicesSettings.timelineFill?.enabled ?? true
    const chapters = story.chapter.currentBranchChapters
    const lorebookEntries = story.lorebook.lorebookEntries
    const characters = story.character.characters
    const locations = story.location.locations
    const items = story.item.items
    const memoryConfig = story.settings.memoryConfig

    let agenticRetrieval: AgenticRetrievalFields | null = null
    let lorebookRetrievalResult: EntryRetrievalResult | null = null
    let timelineFillResult: TimelineFillResult | null = null

    const tasks: Promise<void>[] = []

    // Task 1: Memory retrieval (timeline fill or agentic)
    if (chapters.length > 0 && timelineFillEnabled && memoryConfig.enableRetrieval) {
      tasks.push(
        this.runMemoryRetrieval()
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
    const useAgenticRetrieval = aiService.shouldUseAgenticRetrieval(new Array(chapters.length))
    const hasLoreContent =
      lorebookEntries.length > 0 ||
      characters.length > 0 ||
      locations.length > 0 ||
      items.length > 0
    if (hasLoreContent && !useAgenticRetrieval) {
      tasks.push(
        aiService
          .getRelevantLorebookEntries(
            lorebookEntries,
            story.generationContext.userAction!.content,
            story.entry.visibleEntries.slice(-10),
            { characters, locations, items },
            story.generationContext.activationTracker ?? undefined,
            story.generationContext.abortSignal ?? undefined,
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

    if (story.generationContext.abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'retrieval' } satisfies AbortedEvent
      return false
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

    yield { type: 'phase_complete', phase: 'retrieval' } satisfies PhaseCompleteEvent

    // Write result to singleton before returning
    story.generationContext.retrievalResult = result

    return true
  }

  private async runMemoryRetrieval(): Promise<{
    agenticRetrieval: AgenticRetrievalFields | null
    timelineFillResult: TimelineFillResult | null
  }> {
    const chapters = story.chapter.currentBranchChapters
    if (aiService.shouldUseAgenticRetrieval(new Array(chapters.length))) {
      const result = await aiService.runAgenticRetrieval(
        story.generationContext.userAction!.content,
        story.entry.visibleEntries,
        chapters,
        story.lorebook.lorebookEntries,
        (num, q) => aiService.answerChapterQuestion(num, q, chapters),
        (start, end, q) => aiService.answerChapterRangeQuestion(start, end, q, chapters),
        story.generationContext.abortSignal ?? undefined,
        story.mode,
        story.settings.pov,
        story.settings.tense,
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
      timelineFillResult: await aiService.runTimelineFill(story.entry.visibleEntries, chapters),
    }
  }
}
