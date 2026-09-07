/**
 * PreGenerationPhase - Handles pre-generation setup
 *
 * Responsibilities:
 * - Prepare retry state backup data
 * - Initialize time tracking context
 * - Yield phase events
 */

import type {
  GenerationContext,
  GenerationEvent,
  PhaseStartEvent,
  PhaseCompleteEvent,
} from '../types'
import type {
  StoryEntry,
  Character,
  Location,
  Item,
  StoryBeat,
  TimeTracker,
  ActionInputType,
} from '$lib/types'
import { NO_ACTIVITY, type ActivityReporter } from '$lib/services/activity'

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
  worldState: GenerationContext['worldState']
  visualProseMode: boolean
  streamingEntryId: string
}

/**
 * Additional context needed for pre-generation
 */
export interface PreGenerationInput {
  context: GenerationContext
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
  activity?: ActivityReporter
  /** Step this phase nests under. */
  activityParentId?: string | null
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

    const { context, rawInput, actionType, wasRawActionChoice } = input
    const { story, worldState } = context
    const activity = input.activity ?? NO_ACTIVITY
    const stepId = activity.startStep('Preparing', { parentId: input.activityParentId })

    // Prepare retry backup data
    // The actual backup is created by the caller using ui.createRetryBackup()
    const retryBackupData: RetryBackupData = {
      storyId: story.id,
      entries: [...context.allEntries],
      characters: [...worldState.characters],
      locations: [...worldState.locations],
      items: [...worldState.items],
      storyBeats: [...worldState.storyBeats],
      userActionContent: context.userAction.content,
      rawInput,
      actionType,
      wasRawActionChoice,
      timeTracker: story.timeTracker ?? null,
    }

    // Check if Visual Prose mode is enabled for this story
    const visualProseMode = story.settings?.visualProseMode ?? false

    // Generate a temp entry ID for Visual Prose CSS scoping during streaming
    const streamingEntryId = crypto.randomUUID()

    const result: PreGenerationResult = {
      retryBackupData,
      worldState,
      visualProseMode,
      streamingEntryId,
    }

    activity.endStep(stepId)

    // Emit phase complete
    yield {
      type: 'phase_complete',
      phase: 'pre',
      result,
    } satisfies PhaseCompleteEvent

    return result
  }
}
