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
  isCreativeWritingMode: boolean
  storyId?: string
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
      } else if (event.phase === 'classification') {
        callbacks.setGenerationStatus('Updating world...')
      } else if (event.phase === 'post') {
        callbacks.setGenerationStatus(
          state.isCreativeWritingMode ? 'Generating suggestions...' : 'Generating actions...',
        )
        if (state.isCreativeWritingMode) {
          callbacks.setSuggestionsLoading(true)
        } else {
          callbacks.setActionChoicesLoading(true)
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
