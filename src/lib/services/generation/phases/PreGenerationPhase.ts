/**
 * PreGenerationPhase - Handles pre-generation setup
 *
 * Responsibilities:
 * - Prepare retry state backup data
 * - Initialize time tracking context
 * - Yield phase events
 */

import type { GenerationEvent, PhaseStartEvent, PhaseCompleteEvent } from '../types'
import type {
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  EmbeddedImage,
  TimeTracker,
  ActionInputType,
} from '$lib/types'
import { storyContext } from '$lib/stores/storyContext.svelte'

/**
 * Data needed for retry backup - prepared by this phase, applied by caller
 */
export interface RetryBackupData {
  storyId: string
  entries: StoryEntry[]
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  embeddedImages: EmbeddedImage[]
  userActionContent: string
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
  timeTracker: TimeTracker | null
}

/**
 * Result from pre-generation phase
 */
export interface PreGenerationResult {
  retryBackupData: RetryBackupData
  visualProseMode: boolean
  streamingEntryId: string
}

/**
 * Additional context needed for pre-generation
 */
export interface PreGenerationInput {
  embeddedImages: EmbeddedImage[]
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
}

/**
 * PreGenerationPhase service
 *
 * Prepares the retry backup data and initializes generation context.
 * The caller is responsible for applying the backup via ui.createRetryBackup()
 * since that requires access to the UI store.
 */
export class PreGenerationPhase {
  /**
   * Execute the pre-generation phase
   * Yields phase events and returns prepared data
   */
  async *execute(input: PreGenerationInput): AsyncGenerator<GenerationEvent, PreGenerationResult> {
    // Emit phase start
    yield {
      type: 'phase_start',
      phase: 'pre',
    } satisfies PhaseStartEvent

    const { embeddedImages, rawInput, actionType, wasRawActionChoice } = input

    // Prepare retry backup data — shallow copies break Svelte proxy chains.
    // This is safe because Svelte's reactivity pattern always creates NEW arrays/objects
    // on mutation rather than mutating in place (see ui.svelte.ts createRetryBackup).
    const retryBackupData: RetryBackupData = {
      storyId: storyContext.currentStory!.id,
      entries: [...storyContext.entries],
      characters: storyContext.characters.map((c) => ({
        ...c,
        traits: [...(c.traits || [])],
        visualDescriptors: { ...(c.visualDescriptors || {}) },
      })),
      locations: storyContext.locations.map((l) => ({
        ...l,
        connections: [...(l.connections || [])],
      })),
      items: storyContext.items.map((item) => ({ ...item })),
      storyBeats: storyContext.storyBeats.map((b) => ({ ...b })),
      embeddedImages: [...embeddedImages],
      userActionContent: storyContext.userAction?.content ?? '',
      rawInput,
      actionType,
      wasRawActionChoice,
      timeTracker: storyContext.currentStory?.timeTracker ?? null,
    }

    // Check if Visual Prose mode is enabled for this story
    const visualProseMode = storyContext.currentStory?.settings?.visualProseMode ?? false

    // Generate a temp entry ID for Visual Prose CSS scoping during streaming
    const streamingEntryId = crypto.randomUUID()

    const result: PreGenerationResult = {
      retryBackupData,
      visualProseMode,
      streamingEntryId,
    }

    // Emit phase complete
    yield {
      type: 'phase_complete',
      phase: 'pre',
      result,
    } satisfies PhaseCompleteEvent

    // Write result to singleton before returning
    storyContext.preGenerationResult = result

    return result
  }
}
