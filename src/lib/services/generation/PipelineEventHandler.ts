/**
 * PipelineEventHandler - Maps GenerationEvent pipeline events to UI callbacks.
 * Extracted from ActionInput.svelte for reusability and testability.
 */
import { story } from '$lib/stores/story/index.svelte'
import { ui } from '$lib/stores/ui.svelte'
import { database } from '../database'
import { emitSuggestionsReady, eventBus, type ResponseStreamingEvent } from '../events'
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

const persistSuggestedActions = (actions: unknown[], type: 'suggestions' | 'choices') => {
  const narrationEntry = story.generationContext.promptContext.lastNarrativeEntry
  if (narrationEntry && actions.length > 0) {
    database
      .updateStoryEntry(narrationEntry.id, {
        suggestedActions: JSON.stringify(actions),
      })
      .catch((err) => console.warn(`[ActionInput] Failed to save suggested ${type} to entry:`, err))
  }
}

export function handleEvent(event: GenerationEvent, state: PipelineEventState): void {
  switch (event.type) {
    case 'phase_start':
      if (event.phase === 'narrative') {
        ui.startStreaming(state.visualProseMode, state.streamingEntryId)
      } else if (event.phase === 'classification') {
        ui.setGenerationStatus('Updating world...')
      } else if (event.phase === 'post') {
        ui.setGenerationStatus(
          state.isCreativeWritingMode ? 'Generating suggestions...' : 'Generating actions...',
        )
        if (state.isCreativeWritingMode) {
          ui.setSuggestionsLoading(true)
        } else {
          ui.setActionChoicesLoading(true)
        }
      }
      break

    case 'narrative_chunk':
      if (event.content) {
        ui.appendStreamContent(event.content)
        eventBus.emit<ResponseStreamingEvent>({
          type: 'ResponseStreaming',
          chunk: event.content,
          accumulated: state.fullResponse() + event.content,
        })
      }
      if (event.reasoning) ui.appendReasoningContent(event.reasoning)
      break

    case 'phase_complete':
      if (event.phase === 'post') {
        const postResult = event.result as
          | { suggestions: any[] | null; actionChoices: any[] | null }
          | undefined
        if (postResult?.suggestions) {
          ui.setSuggestions(postResult.suggestions, state.storyId)
          persistSuggestedActions(postResult.suggestions, 'suggestions')
          emitSuggestionsReady(
            postResult.suggestions.map((s: any) => ({ text: s.text, type: s.type })),
          )
          ui.setSuggestionsLoading(false)
        } else if (postResult?.actionChoices) {
          ui.setActionChoices(postResult.actionChoices, state.storyId)
          persistSuggestedActions(postResult.actionChoices, 'choices')
          ui.setActionChoicesLoading(false)
        } else {
          ui.setSuggestionsLoading(false)
          ui.setActionChoicesLoading(false)
        }
      }
      if (event.phase === 'retrieval') {
        ui.setLastLorebookRetrieval(
          story.generationContext.retrievalResult?.lorebookRetrievalResult ?? null,
        )
      }
      break
    case 'error':
      if (event.fatal) {
        console.error('[ActionInput] Fatal pipeline error:', event.error)
      }
      break
  }
}
