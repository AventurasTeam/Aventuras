/**
 * Event Bus for Aventura
 * Per design doc section 2.1: Event-Driven Architecture
 *
 * Modules subscribe to events they care about, do their work, and emit new events.
 * Modules don't call each other directly - they communicate through events and shared state.
 */

import { createLogger } from '$lib/log'

const log = createLogger('EventBus')

// Event types per design doc section 2.3
export type EventType =
  | 'UserInput' // User sends a message
  | 'ContextReady' // Memory + entries prepared for narrator
  | 'ResponseStreaming' // Tokens arriving from narrator
  | 'SentenceComplete' // Full sentence ready for TTS
  | 'NarrativeResponse' // Complete response from narrator
  | 'ClassificationComplete' // Structured analysis ready
  | 'SuggestionsReady' // AI suggestions generated (creative mode)
  | 'StateUpdated' // Entries/world state changed
  | 'ChapterCreated' // New chapter summarized
  | 'ImageAnalysisStarted' // Started analyzing narrative for imageable scenes
  | 'ImageAnalysisComplete' // Finished analyzing narrative for imageable scenes
  | 'ImageAnalysisFailed' // Image analysis or generation failed
  | 'ImageQueued' // Image generation requested
  | 'ImageReady' // Image generation complete
  | 'TTSQueued' // TTS generation requested for entry
  | 'SaveComplete' // Autosave finished
  | 'CheckpointCreated' // Checkpoint saved
  | 'CheckpointRestored' // Checkpoint restored
  | 'StoryLoaded' // Story loaded into state
  | 'StoryCreated' // New story created
  | 'ModeChanged' // Story mode changed
  | 'BackgroundImageAnalysisStarted' // Started analyzing narrative for background image
  | 'BackgroundImageAnalysisComplete' // Finished analyzing narrative for background image
  | 'BackgroundImageAnalysisFailed' // Background image analysis or generation failed
  | 'BackgroundImageQueued' // Background image generation requested
  | 'BackgroundImageReady' // Background image generation complete

// Event payloads
export interface UserInputEvent {
  type: 'UserInput'
  text: string
  actionType?: 'do' | 'say' | 'think' | 'story' | 'direction' | 'free'
}

export interface ContextReadyEvent {
  type: 'ContextReady'
  userInput: string
  retrievedContext: string | null
}

export interface ResponseStreamingEvent {
  type: 'ResponseStreaming'
  chunk: string
  accumulated: string
}

export interface SentenceCompleteEvent {
  type: 'SentenceComplete'
  text: string
}

export interface NarrativeResponseEvent {
  type: 'NarrativeResponse'
  messageId: string
  content: string
}

export interface ClassificationCompleteEvent {
  type: 'ClassificationComplete'
  messageId: string
  result: any // ClassificationResult
}

export interface SuggestionsReadyEvent {
  type: 'SuggestionsReady'
  suggestions: { text: string; type: string }[]
}

export interface StateUpdatedEvent {
  type: 'StateUpdated'
  changes: {
    characters?: number
    locations?: number
    items?: number
    storyBeats?: number
  }
}

export interface ChapterCreatedEvent {
  type: 'ChapterCreated'
  chapterId: string
  chapterNumber: number
  title: string | null
}

export interface CheckpointCreatedEvent {
  type: 'CheckpointCreated'
  checkpointId: string
  name: string
}

export interface CheckpointRestoredEvent {
  type: 'CheckpointRestored'
  checkpointId: string
}

export interface StoryLoadedEvent {
  type: 'StoryLoaded'
  storyId: string
  mode: 'adventure' | 'creative-writing'
}

export interface StoryCreatedEvent {
  type: 'StoryCreated'
  storyId: string
  mode: 'adventure' | 'creative-writing'
}

export interface ModeChangedEvent {
  type: 'ModeChanged'
  mode: 'adventure' | 'creative-writing'
}

export interface SaveCompleteEvent {
  type: 'SaveComplete'
  storyId: string
}

export interface ImageAnalysisStartedEvent {
  type: 'ImageAnalysisStarted'
  entryId: string
}

export interface BackgroundImageAnalysisStartedEvent {
  type: 'BackgroundImageAnalysisStarted'
}

export interface BackgroundImageAnalysisCompleteEvent {
  type: 'BackgroundImageAnalysisComplete'
}

export interface BackgroundImageAnalysisFailedEvent {
  type: 'BackgroundImageAnalysisFailed'
}

export interface BackgroundImageQueuedEvent {
  type: 'BackgroundImageQueued'
}

export interface BackgroundImageReadyEvent {
  type: 'BackgroundImageReady'
}

export interface ImageAnalysisCompleteEvent {
  type: 'ImageAnalysisComplete'
  entryId: string
  sceneCount: number
  portraitCount: number
}

export interface ImageAnalysisFailedEvent {
  type: 'ImageAnalysisFailed'
  entryId: string
  error: string
}

export interface ImageQueuedEvent {
  type: 'ImageQueued'
  imageId: string
  entryId: string
}

export interface ImageReadyEvent {
  type: 'ImageReady'
  imageId: string
  entryId: string
  success: boolean
}

export interface TTSQueuedEvent {
  type: 'TTSQueued'
  entryId: string
  content: string
}

export interface GenericEvent {
  type: EventType
  payload?: any
}

// Union of all event types
export type AventuraEvent =
  | UserInputEvent
  | ContextReadyEvent
  | ResponseStreamingEvent
  | SentenceCompleteEvent
  | NarrativeResponseEvent
  | ClassificationCompleteEvent
  | SuggestionsReadyEvent
  | StateUpdatedEvent
  | ChapterCreatedEvent
  | CheckpointCreatedEvent
  | CheckpointRestoredEvent
  | StoryLoadedEvent
  | StoryCreatedEvent
  | ModeChangedEvent
  | SaveCompleteEvent
  | ImageAnalysisStartedEvent
  | ImageAnalysisCompleteEvent
  | ImageAnalysisFailedEvent
  | ImageQueuedEvent
  | ImageReadyEvent
  | GenericEvent
  | BackgroundImageAnalysisStartedEvent
  | BackgroundImageAnalysisCompleteEvent
  | BackgroundImageAnalysisFailedEvent
  | BackgroundImageQueuedEvent
  | BackgroundImageReadyEvent

// Handler function type
export type EventHandler<T extends AventuraEvent = AventuraEvent> = (
  event: T,
) => void | Promise<void>

// Unsubscribe function type
export type Unsubscribe = () => void

// Logged event with metadata
interface LoggedEvent {
  id: string
  type: EventType
  timestamp: number
  payload: any
}

class EventBus {
  private listeners: Map<EventType, Set<EventHandler>> = new Map()
  private eventLog: LoggedEvent[] = []
  private maxLogSize = 100

  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  subscribe<T extends AventuraEvent>(type: EventType, handler: EventHandler<T>): Unsubscribe {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(handler as EventHandler)
    log('Subscribed to', type)

    return () => {
      this.listeners.get(type)?.delete(handler as EventHandler)
      log('Unsubscribed from', type)
    }
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T extends AventuraEvent>(event: T): void {
    const logEntry: LoggedEvent = {
      id: crypto.randomUUID(),
      type: event.type as EventType,
      timestamp: Date.now(),
      payload: event,
    }

    // Log the event
    this.eventLog.push(logEntry)
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift()
    }

    log('Emit', event.type, event)

    // Notify subscribers
    const handlers = this.listeners.get(event.type as EventType)
    if (handlers) {
      for (const handler of handlers) {
        try {
          const result = handler(event)
          // Handle async handlers
          if (result instanceof Promise) {
            result.catch((err) => {
              console.error(`Error in event handler for ${event.type}:`, err)
            })
          }
        } catch (err) {
          console.error(`Error in event handler for ${event.type}:`, err)
        }
      }
    }
  }

  /**
   * Get recent events from the log.
   */
  getRecentEvents(count = 10): LoggedEvent[] {
    return this.eventLog.slice(-count)
  }

  /**
   * Get events of a specific type from the log.
   */
  getEventsByType(type: EventType, count = 10): LoggedEvent[] {
    return this.eventLog.filter((e) => e.type === type).slice(-count)
  }

  /**
   * Clear all listeners (useful for cleanup/testing).
   */
  clear(): void {
    this.listeners.clear()
    log('All listeners cleared')
  }

  /**
   * Get count of listeners for a specific event type.
   */
  listenerCount(type: EventType): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

// Singleton instance
export const eventBus = new EventBus()

// Helper functions for common event emissions
export function emitUserInput(text: string, actionType?: UserInputEvent['actionType']): void {
  eventBus.emit<UserInputEvent>({ type: 'UserInput', text, actionType })
}

export function emitNarrativeResponse(messageId: string, content: string): void {
  eventBus.emit<NarrativeResponseEvent>({ type: 'NarrativeResponse', messageId, content })
}

export function emitClassificationComplete(messageId: string, result: any): void {
  eventBus.emit<ClassificationCompleteEvent>({ type: 'ClassificationComplete', messageId, result })
}

export function emitStateUpdated(changes: StateUpdatedEvent['changes']): void {
  eventBus.emit<StateUpdatedEvent>({ type: 'StateUpdated', changes })
}

export function emitChapterCreated(
  chapterId: string,
  chapterNumber: number,
  title: string | null,
): void {
  eventBus.emit<ChapterCreatedEvent>({ type: 'ChapterCreated', chapterId, chapterNumber, title })
}

export function emitSuggestionsReady(suggestions: { text: string; type: string }[]): void {
  eventBus.emit<SuggestionsReadyEvent>({ type: 'SuggestionsReady', suggestions })
}

export function emitStoryLoaded(storyId: string, mode: 'adventure' | 'creative-writing'): void {
  eventBus.emit<StoryLoadedEvent>({ type: 'StoryLoaded', storyId, mode })
}

export function emitModeChanged(mode: 'adventure' | 'creative-writing'): void {
  eventBus.emit<ModeChangedEvent>({ type: 'ModeChanged', mode })
}

export function emitImageAnalysisStarted(entryId: string): void {
  eventBus.emit<ImageAnalysisStartedEvent>({ type: 'ImageAnalysisStarted', entryId })
}

export function emitBackgroundImageAnalysisStarted(): void {
  eventBus.emit<BackgroundImageAnalysisStartedEvent>({
    type: 'BackgroundImageAnalysisStarted',
  })
}

export function emitBackgroundImageAnalysisComplete(): void {
  eventBus.emit<BackgroundImageAnalysisCompleteEvent>({
    type: 'BackgroundImageAnalysisComplete',
  })
}

export function emitBackgroundImageAnalysisFailed(): void {
  eventBus.emit<BackgroundImageAnalysisFailedEvent>({
    type: 'BackgroundImageAnalysisFailed',
  })
}

export function emitBackgroundImageQueued(): void {
  eventBus.emit<BackgroundImageQueuedEvent>({
    type: 'BackgroundImageQueued',
  })
}

export function emitBackgroundImageReady(): void {
  eventBus.emit<BackgroundImageReadyEvent>({
    type: 'BackgroundImageReady',
  })
}

export function emitImageAnalysisComplete(
  entryId: string,
  sceneCount: number,
  portraitCount: number,
): void {
  eventBus.emit<ImageAnalysisCompleteEvent>({
    type: 'ImageAnalysisComplete',
    entryId,
    sceneCount,
    portraitCount,
  })
}

export function emitImageAnalysisFailed(entryId: string, error: string): void {
  eventBus.emit<ImageAnalysisFailedEvent>({ type: 'ImageAnalysisFailed', entryId, error })
}

export function emitImageQueued(imageId: string, entryId: string): void {
  eventBus.emit<ImageQueuedEvent>({ type: 'ImageQueued', imageId, entryId })
}

export function emitImageReady(imageId: string, entryId: string, success: boolean): void {
  eventBus.emit<ImageReadyEvent>({ type: 'ImageReady', imageId, entryId, success })
}

export function emitTTSQueued(entryId: string, content: string): void {
  eventBus.emit<TTSQueuedEvent>({ type: 'TTSQueued', entryId, content })
}
