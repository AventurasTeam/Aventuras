/**
 * PipelineEventHandler - Maps GenerationEvent pipeline events to UI callbacks.
 * Extracted from ActionInput.svelte for reusability and testability.
 */
import type { GenerationEvent } from './types'

export interface PipelineUICallbacks {
  startStreaming: (visualProseMode: boolean, streamingEntryId: string) => void
  appendStreamContent: (content: string) => void
  appendReasoningContent: (reasoning: string) => void
  setGenerationStatus: (status: string) => void
  setSuggestionsLoading: (loading: boolean) => void
  setActionChoicesLoading: (loading: boolean) => void
  setSuggestions: (suggestions: any[], storyId?: string) => void
  setActionChoices: (choices: any[], storyId?: string) => void
  emitResponseStreaming: (chunk: string, accumulated: string) => void
  emitSuggestionsReady: (suggestions: Array<{ text: string; type: string }>) => void
}

export interface PipelineEventState {
  fullResponse: () => string
  fullReasoning: () => string
  streamingEntryId: string
  visualProseMode: boolean
  isCreativeMode: boolean
  storyId?: string
  /** Tracks which parallel phases are currently running */
  activeParallelPhases: Set<string>
}

/** Phases that run concurrently after the narrative phase.
 *  Note: BackgroundImagePhase and ImagePhase both emit phase 'image',
 *  but are not tracked here — they run inside imagePipeline or independently. */
const PARALLEL_PHASES = new Set(['classification', 'translation', 'post'])

/** Human-readable labels shown when a single parallel phase remains.
 *  'post' is handled separately in parallelStatusMessage (creative vs adventure). */
const PHASE_LABELS: Record<string, string> = {
  classification: 'Updating world...',
  translation: 'Translating...',
}

/** Build the status message based on how many parallel phases are active */
function parallelStatusMessage(activePhases: Set<string>, isCreativeMode: boolean): string {
  if (activePhases.size === 0) return ''
  if (activePhases.size === 1) {
    const phase = activePhases.values().next().value!
    if (phase === 'post') {
      return isCreativeMode ? 'Generating suggestions...' : 'Generating actions...'
    }
    return PHASE_LABELS[phase] ?? 'Processing...'
  }
  return `Processing ${activePhases.size} tasks...`
}

export function handleEvent(
  event: GenerationEvent,
  state: PipelineEventState,
  callbacks: PipelineUICallbacks,
): void {
  switch (event.type) {
    case 'phase_start':
      if (event.phase === 'narrative') {
        callbacks.startStreaming(state.visualProseMode, state.streamingEntryId)
      } else if (PARALLEL_PHASES.has(event.phase)) {
        state.activeParallelPhases.add(event.phase)
        callbacks.setGenerationStatus(
          parallelStatusMessage(state.activeParallelPhases, state.isCreativeMode),
        )

        // Keep loading spinners for suggestions/actions
        if (event.phase === 'post') {
          if (state.isCreativeMode) {
            callbacks.setSuggestionsLoading(true)
          } else {
            callbacks.setActionChoicesLoading(true)
          }
        }
      }
      break

    case 'narrative_chunk':
      if (event.content) {
        callbacks.appendStreamContent(event.content)
        callbacks.emitResponseStreaming(event.content, state.fullResponse() + event.content)
      }
      if (event.reasoning) callbacks.appendReasoningContent(event.reasoning)
      break

    case 'phase_complete':
      if (PARALLEL_PHASES.has(event.phase)) {
        state.activeParallelPhases.delete(event.phase)
        callbacks.setGenerationStatus(
          parallelStatusMessage(state.activeParallelPhases, state.isCreativeMode),
        )
      }

      if (event.phase === 'post') {
        const postResult = event.result as
          | { suggestions: any[] | null; actionChoices: any[] | null }
          | undefined
        if (postResult?.suggestions) {
          callbacks.setSuggestions(postResult.suggestions, state.storyId)
          callbacks.emitSuggestionsReady(
            postResult.suggestions.map((s: any) => ({ text: s.text, type: s.type })),
          )
          callbacks.setSuggestionsLoading(false)
        } else if (postResult?.actionChoices) {
          callbacks.setActionChoices(postResult.actionChoices, state.storyId)
          callbacks.setActionChoicesLoading(false)
        } else {
          callbacks.setSuggestionsLoading(false)
          callbacks.setActionChoicesLoading(false)
        }
      }
      break
  }
}
