/**
 * Generation Pipeline Types
 * Core types for the generation pipeline. Events use a discriminated union pattern.
 */

import type {
  Story,
  StoryEntry,
  Chapter,
  Character,
  Location,
  Item,
  StoryBeat,
  MemoryConfig,
  Entry,
} from '$lib/types'
import type { ClassificationResult } from '$lib/services/ai/sdk/schemas/classifier'
import type { TimelineFillResult } from '$lib/services/ai/retrieval'
import type { EntryRetrievalResult } from '$lib/services/ai/retrieval/EntryRetrievalService'

// Generation Phases
export type GenerationPhase =
  | 'pre' // Retry state backup, time tracking init
  | 'retrieval' // Memory retrieval, lorebook retrieval
  | 'narrative' // Streaming narrative generation
  | 'classification' // World state extraction
  | 'translation' // Narration and world state translation
  | 'image' // Image generation
  | 'post' // Suggestions, action choices, lore management

// World state passed to pipeline
export interface WorldState {
  characters: Character[]
  locations: Location[]
  items: Item[]
  storyBeats: StoryBeat[]
  currentLocation?: Location
  chapters: Chapter[]
  memoryConfig: MemoryConfig
  lorebookEntries: Entry[]
}

// Input context for the pipeline
export interface GenerationContext {
  story: Story
  visibleEntries: StoryEntry[]
  allEntries: StoryEntry[]
  worldState: WorldState
  userAction: { entryId: string; content: string; rawInput: string }
  narrationEntryId?: string
  abortSignal?: AbortSignal
}

// Output from retrieval phase
export interface RetrievalResult {
  chapterContext: string | null
  lorebookContext: string | null
  lorebookRetrievalResult: EntryRetrievalResult | null
  timelineFillResult: TimelineFillResult | null
  combinedContext: string | null
}

// Generation Events (discriminated union)
export interface PhaseStartEvent {
  type: 'phase_start'
  phase: GenerationPhase
}

export interface PhaseCompleteEvent {
  type: 'phase_complete'
  phase: GenerationPhase
  result?: unknown
}

export interface NarrativeChunkEvent {
  type: 'narrative_chunk'
  content: string
  reasoning?: string
}

export interface NarrativeCompleteEvent {
  type: 'narrative_complete'
  content: string
  reasoning: string
  entryId: string
}

export interface ClassificationCompleteEvent {
  type: 'classification_complete'
  result: ClassificationResult
}

export interface ErrorEvent {
  type: 'error'
  phase: GenerationPhase
  error: Error
  fatal: boolean
}

export interface AbortedEvent {
  type: 'aborted'
  phase: GenerationPhase
}

export type GenerationEvent =
  | PhaseStartEvent
  | PhaseCompleteEvent
  | NarrativeChunkEvent
  | NarrativeCompleteEvent
  | ClassificationCompleteEvent
  | ErrorEvent
  | AbortedEvent
