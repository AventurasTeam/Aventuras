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
import type { TimelineFillResult } from '$lib/services/ai/retrieval/TimelineFillService'
import type { RetrievalResult as AgenticRetrievalResult } from '$lib/services/ai/retrieval/AgenticRetrievalService'
import type {
  EntryRetrievalResult,
  ActivationTracker,
} from '$lib/services/ai/retrieval/EntryRetrievalService'
import {
  formatAlreadyInContext,
  type ContextEntity,
} from '$lib/services/ai/retrieval/alreadyInContext'
import { joinPromptBlocks } from '$lib/utils/promptBlocks'

/** Dependencies injected from AIService - phase calls these methods rather than duplicating logic */
export interface RetrievalDependencies {
  shouldUseAgenticRetrieval: () => boolean
  runAgenticRetrieval: (options: {
    userInput: string
    recentEntries: GenerationContext['visibleEntries']
    chapters: GenerationContext['worldState']['chapters']
    entries: GenerationContext['worldState']['lorebookEntries']
    onQueryChapter: (chapterNumber: number, question: string) => Promise<string>
    worldState?: GenerationContext['worldState']
    currentStoryTime?: GenerationContext['story']['timeTracker']
    alreadyInContext?: string
    signal?: AbortSignal
  }) => Promise<AgenticRetrievalResult>
  runTimelineFill: (
    visibleEntries: GenerationContext['visibleEntries'],
    chapters: GenerationContext['worldState']['chapters'],
    alreadyInContext?: string,
  ) => Promise<TimelineFillResult>
  answerChapterQuestion: (
    chapterNumber: number,
    question: string,
    chapters: GenerationContext['worldState']['chapters'],
  ) => Promise<string>
  buildWorldStateContext: (
    worldState: GenerationContext['worldState'],
    userInput: string,
    recentEntries: GenerationContext['visibleEntries'],
    signal?: AbortSignal,
    activationTracker?: ActivationTracker,
  ) => Promise<{ contextBlock: string; all: { type: string; name: string }[] }>
  getRelevantLorebookEntries: (
    entries: GenerationContext['worldState']['lorebookEntries'],
    userInput: string,
    recentStoryEntries: GenerationContext['visibleEntries'],
    activationTracker?: ActivationTracker,
    signal?: AbortSignal,
  ) => Promise<EntryRetrievalResult>
}

export interface RetrievalInput {
  context: GenerationContext
  dependencies: RetrievalDependencies
  memoryRetrievalEnabled: boolean
  activationTracker?: ActivationTracker
}

export class RetrievalPhase {
  async *execute(input: RetrievalInput): AsyncGenerator<GenerationEvent, RetrievalResult> {
    yield { type: 'phase_start', phase: 'retrieval' } satisfies PhaseStartEvent

    const { context, dependencies, memoryRetrievalEnabled, activationTracker } = input
    const { worldState, visibleEntries, userAction, abortSignal } = context
    const { chapters, lorebookEntries, memoryConfig } = worldState

    let chapterContext: string | null = null
    let lorebookContext: string | null = null
    let lorebookRetrievalResult: EntryRetrievalResult | null = null
    let timelineFillResult: TimelineFillResult | null = null
    let worldStateBlock: string | null = null

    let worldStateEntities: ContextEntity[] = []
    let lorebookEntities: ContextEntity[] = []

    // `formatAlreadyInContext` is only usable if it is complete -- it is read as a
    // statement about the prompt, so naming half of what the narrator has invites work on
    // the other half under the impression it is missing. Either half failing therefore
    // suppresses the whole summary rather than shipping a partial one.
    let contextInventoryComplete = true

    // Stage A: what the narrator gets regardless of memory retrieval.
    //
    // Both are unconditional and both are mostly free -- tiers 1 and 2 are string matching,
    // and only tier 3 costs an LLM call, gated on the candidate pool. They run together
    // because neither reads the other's output, and the activation tracker they share is
    // safe to touch concurrently: `currentPosition` is fixed for the whole turn at
    // construction, and they write disjoint id spaces (entity uuids vs lorebook Entry uuids).
    const stageA: Promise<void>[] = []

    stageA.push(
      dependencies
        .buildWorldStateContext(
          worldState,
          userAction.content,
          visibleEntries,
          abortSignal,
          activationTracker,
        )
        .then((result) => {
          worldStateBlock = result.contextBlock
          worldStateEntities = result.all.map((e) => ({ type: e.type, name: e.name }))
        })
        .catch((err) => {
          contextInventoryComplete = false
          if (err instanceof Error && err.name === 'AbortError') return
          console.warn('[RetrievalPhase] World state injection failed (non-fatal):', err)
        }),
    )

    // Lorebook retrieval used to be skipped in agentic mode, on the basis that the agent
    // selected entries itself -- which required a fallback for when the agent delivered
    // nothing, and made "who put this entry in the prompt" unanswerable. The agent no longer
    // selects (`select_entry` is gone); it only reads lore while reasoning about chapters.
    // Entry selection has one owner again, so there is no skip and nothing to fall back to.
    const hasLoreContent = lorebookEntries.length > 0
    if (hasLoreContent) {
      stageA.push(
        dependencies
          .getRelevantLorebookEntries(
            lorebookEntries,
            userAction.content,
            // Not pre-sliced: the service applies its own configured Recent Entries
            // Window. A fixed slice here silently capped that setting -- the slider goes
            // to 15, and anything above 10 did nothing.
            visibleEntries,
            activationTracker,
            abortSignal,
          )
          .then((result) => {
            lorebookRetrievalResult = result
            lorebookContext = result.contextBlock
            lorebookEntities = result.all.map((r) => ({
              type: r.entry.type,
              name: r.entry.name,
            }))
          })
          .catch((err) => {
            contextInventoryComplete = false
            if (err instanceof Error && err.name === 'AbortError') return
            console.warn('[RetrievalPhase] Lorebook retrieval failed (non-fatal):', err)
          }),
      )
    }

    await Promise.all(stageA)

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'retrieval' } satisfies AbortedEvent
      return {
        worldStateBlock: null,
        chapterContext: null,
        lorebookContext: null,
        lorebookRetrievalResult: null,
        timelineFillResult: null,
        combinedContext: null,
      }
    }

    // Stage B: memory retrieval, told what Stage A already put in the prompt.
    //
    // Sequential rather than parallel with Stage A, and that ordering is the whole point:
    // the summary has to be complete to be usable, and it is only complete once both tier 3
    // passes have run. Handing over a partial list would be worse than handing over none --
    // it is read as a statement about the prompt, so naming half of it invites work on the
    // other half under the impression it is missing.
    //
    // Gated on chapters because memory retrieval reads them: with none, the agent's tools
    // have nothing to search and the run is a wasted agent loop.
    const useAgenticRetrieval = dependencies.shouldUseAgenticRetrieval() && chapters.length > 0

    if (chapters.length > 0 && memoryRetrievalEnabled && memoryConfig.enableRetrieval) {
      const alreadyInContext = contextInventoryComplete
        ? formatAlreadyInContext(worldStateEntities, lorebookEntities)
        : ''
      if (!contextInventoryComplete) {
        console.warn(
          '[RetrievalPhase] Stage A partially failed; omitting the already-in-context summary',
        )
      }

      try {
        const result = await this.runMemoryRetrieval(input, useAgenticRetrieval, alreadyInContext)
        chapterContext = result.chapterContext
        timelineFillResult = result.timelineFillResult
      } catch (err) {
        if (!(err instanceof Error && err.name === 'AbortError')) {
          console.warn('[RetrievalPhase] Memory retrieval failed (non-fatal):', err)
        }
      }
    }

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'retrieval' } satisfies AbortedEvent
      return {
        worldStateBlock: null,
        chapterContext: null,
        lorebookContext: null,
        lorebookRetrievalResult: null,
        timelineFillResult: null,
        combinedContext: null,
      }
    }

    // `joinPromptBlocks` rather than `join('\n')`: the lorebook block already opens with a
    // blank line, so joining with one more produced three newlines between the two.
    const combinedContext = joinPromptBlocks(chapterContext, lorebookContext) || null
    const result: RetrievalResult = {
      worldStateBlock,
      chapterContext,
      lorebookContext,
      lorebookRetrievalResult,
      timelineFillResult,
      combinedContext,
    }

    yield { type: 'phase_complete', phase: 'retrieval', result } satisfies PhaseCompleteEvent
    return result
  }

  private async runMemoryRetrieval(
    input: RetrievalInput,
    useAgenticRetrieval: boolean,
    alreadyInContext: string,
  ): Promise<{
    chapterContext: string | null
    timelineFillResult: TimelineFillResult | null
  }> {
    const { context, dependencies } = input
    const { worldState, visibleEntries, userAction, abortSignal, story } = context
    const { chapters, lorebookEntries } = worldState

    if (useAgenticRetrieval) {
      const result = await dependencies.runAgenticRetrieval({
        userInput: userAction.content,
        recentEntries: visibleEntries,
        chapters,
        entries: lorebookEntries,
        onQueryChapter: (num, q) => dependencies.answerChapterQuestion(num, q, chapters),
        worldState,
        currentStoryTime: story.timeTracker,
        alreadyInContext,
        signal: abortSignal,
      })
      return { chapterContext: result.context || null, timelineFillResult: null }
    }

    return {
      chapterContext: null,
      timelineFillResult: await dependencies.runTimelineFill(
        visibleEntries,
        chapters,
        alreadyInContext,
      ),
    }
  }
}
