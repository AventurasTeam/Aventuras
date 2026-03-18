/**
 * ClassificationPhase - Handles world state extraction from narrative
 *
 * Responsibilities:
 * - Call classifier service to extract world state changes
 * - Coordinate entity updates (characters, locations, items, story beats)
 * - Yield classification events
 */

import type {
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
  AbortedEvent,
  ErrorEvent,
  ClassificationCompleteEvent,
} from '../types'
import type {
  Story,
  StoryEntry,
  TimeTracker,
  Character,
  Location,
  Item,
  StoryBeat,
  Chapter,
  MemoryConfig,
  Entry,
} from '$lib/types'
import type { ClassificationResult } from '$lib/services/ai/sdk/schemas/classifier'
import { storyContext } from '$lib/stores/storyContext.svelte'

/** Local WorldState interface for classifyResponse callback — deleted from types.ts in Phase 23, Phase 25 removes this need */
interface WorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters: Chapter[]
  memoryConfig: MemoryConfig
  lorebookEntries: Entry[]
}

/** Dependencies for classification phase - injected to avoid tight coupling */
export interface ClassificationDependencies {
  classifyResponse: (
    narrativeResponse: string,
    userAction: string,
    worldState: WorldState,
    story: Story | null | undefined,
    chatHistoryEntries: StoryEntry[],
    timeTracker: TimeTracker | null | undefined,
  ) => Promise<ClassificationResult>
}

/** Input for the classification phase — all story data comes from singleton snapshot */
export interface ClassificationInput {
  // Empty — all data comes from singleton snapshot
}

/** Result from classification phase */
export interface ClassificationPhaseResult {
  classificationResult: ClassificationResult
  narrativeEntryId: string
}

/**
 * ClassificationPhase service
 * Extracts world state changes from narrative using AI classifier.
 */
export class ClassificationPhase {
  constructor(private deps: ClassificationDependencies) {}

  /** Execute the classification phase - yields events and returns result */
  async *execute(): AsyncGenerator<GenerationEvent, ClassificationPhaseResult | null> {
    // === CONCURRENT PHASE SAFETY: Snapshot ALL singleton inputs before first yield ===
    const narrativeContent = storyContext.narrativeResult?.content ?? ''
    const narrativeEntryId = storyContext.narrationEntryId ?? ''
    const userActionContent = storyContext.userAction?.content ?? ''
    const story = storyContext.currentStory
    const visibleEntries = storyContext.visibleEntries
    const abortSignal = storyContext.abortSignal ?? undefined
    // Build WorldState for classifyResponse callback (Phase 25 will remove this need)
    const worldState: WorldState = {
      characters: [...storyContext.characters],
      locations: [...storyContext.locations],
      items: [...storyContext.items],
      storyBeats: [...storyContext.storyBeats],
      currentLocation: storyContext.currentLocation,
      chapters: storyContext.currentBranchChapters,
      memoryConfig: storyContext.currentStory?.memoryConfig ?? {
        enableRetrieval: true,
        autoSummarize: false,
        tokenThreshold: 4000,
        chapterBuffer: 200,
        maxChaptersPerRetrieval: 3,
      },
      lorebookEntries: storyContext.lorebookEntries,
    }
    // === End snapshot block — NO storyContext.* reads below this line ===

    yield { type: 'phase_start', phase: 'classification' } satisfies PhaseStartEvent

    if (abortSignal?.aborted) {
      yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
      return null
    }

    try {
      // Filter out the current narration entry to avoid sending it twice
      // (once in chatHistory, once as narrativeResponse)
      const chatHistoryEntries = visibleEntries.filter((e) => e.id !== narrativeEntryId)

      const classificationResult = await this.deps.classifyResponse(
        narrativeContent,
        userActionContent,
        worldState,
        story,
        chatHistoryEntries,
        story?.timeTracker,
      )

      if (abortSignal?.aborted) {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return null
      }

      // Emit classification complete event
      yield {
        type: 'classification_complete',
        result: classificationResult,
      } satisfies ClassificationCompleteEvent

      const result: ClassificationPhaseResult = {
        classificationResult,
        narrativeEntryId,
      }

      yield {
        type: 'phase_complete',
        phase: 'classification',
        result,
      } satisfies PhaseCompleteEvent

      storyContext.classificationResult = result
      return result
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: 'aborted', phase: 'classification' } satisfies AbortedEvent
        return null
      }

      // Classification errors are non-fatal - world state just won't be updated
      yield {
        type: 'error',
        phase: 'classification',
        error: error instanceof Error ? error : new Error(String(error)),
        fatal: false,
      } satisfies ErrorEvent

      return null
    }
  }
}
