/**
 * ActionInputController - Orchestrates generation logic extracted from ActionInput.svelte.
 *
 * This controller owns:
 * - translateUserInput (static helper)
 * - generateResponse (core generation pipeline loop)
 * - handleSubmit (submit handler)
 * - handleStopGeneration (stop and restore state)
 * - handleRetry (retry after error)
 * - handleRetryLastMessage (retry with new generation)
 * - refreshSuggestions / regenerateActionsAfterDelete
 *
 * The component creates an instance with a callback interface for all UI interaction.
 * The controller reads directly from store singletons (story, settings) for state.
 */

import { tick } from 'svelte'
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService, type ImageGenerationContext } from '$lib/services/ai'
import { database } from '$lib/services/database'
import { SimpleActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { mapChatEntries } from '$lib/services/context/classifierMapper'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import {
  GenerationPipeline,
  retryService,
  BackgroundTaskCoordinator,
  WorldStateTranslationService,
  handleEvent,
  SuggestionsRefreshService,
} from '$lib/services/generation'
import type { PipelineUICallbacks, PipelineEventState } from '$lib/services/generation'
import { InlineImageTracker } from '$lib/services/ai/image'
import { eventBus } from '$lib/services/events'
import type { ClassificationCompleteEvent } from '$lib/services/events'

function log(...args: any[]) {
  console.log('[ActionInput]', ...args)
}

// ============================================================================
// Types
// ============================================================================

export type ActionType = 'do' | 'say' | 'think' | 'story' | 'free'

export interface SubmitInput {
  inputValue: string
  actionType: ActionType
  isRawActionChoice: boolean
  isCreativeWritingMode: boolean
  actionPrefixes: Record<string, string>
  actionSuffixes: Record<string, string>
}

export interface ActionInputCallbacks {
  // Streaming lifecycle
  startStreaming: (visualProseMode: boolean, streamingEntryId: string) => void
  endStreaming: () => void
  appendStreamContent: (content: string) => void
  appendReasoningContent: (content: string) => void

  // Generation state
  setGenerating: (generating: boolean) => void
  clearGenerationError: () => void
  setGenerationError: (error: any) => void
  setGenerationStatus: (status: string) => void

  // Suggestions/action choices
  setSuggestionsLoading: (loading: boolean) => void
  setActionChoicesLoading: (loading: boolean) => void
  setSuggestions: (suggestions: any[], storyId: string) => void
  setActionChoices: (choices: any[], storyId: string) => void
  clearSuggestions: (storyId: string) => void
  clearActionChoices: (storyId: string) => void

  // Retry
  createRetryBackup: (...args: any[]) => void
  clearRetryBackup: (clearFromDb?: boolean) => void
  getRetryBackup: () => any
  isRetryingLastMessage: () => boolean
  setRetryingLastMessage: (retrying: boolean) => void

  // Activation data
  updateActivationData: (tracker: any, storyId: string) => void
  getActivationTracker: (position: number) => any
  restoreActivationData: (data: any, position: number) => void
  clearActivationData: () => void

  // Lorebook
  setLastLorebookRetrieval: (result: any | null) => void

  // Style review
  getLastStyleReview: () => any | null

  // Events
  emitNarrativeResponse: (entryId: string, content: string) => void
  emitUserInput: (content: string, type: string) => void
  emitResponseStreaming: (chunk: string, accumulated: string) => void
  emitSuggestionsReady: (suggestions: any[]) => void
  emitTTSQueued: (entryId: string, content: string) => void

  // Platform
  sendGenerationNotification: (text: string, success: boolean) => void
  wasBackgroundedDuringGeneration: () => boolean
  isAppBackgrounded: () => boolean
  resetBackgroundedFlag: () => void

  // Android
  startGenerationService: () => void
  stopGenerationService: () => void
  shouldUseBackgroundService: () => boolean

  // Scroll
  resetScrollBreak: () => void

  // Error state
  getLastGenerationError: () => any | null
}

// ============================================================================
// Static helpers
// ============================================================================

export async function translateUserInput(
  content: string,
  translationSettings: typeof settings.translationSettings,
): Promise<{ promptContent: string; originalInput: string | undefined }> {
  if (!TranslationService.shouldTranslateInput(translationSettings)) {
    return { promptContent: content, originalInput: undefined }
  }

  try {
    log('Translating user input', {
      sourceLanguage: translationSettings.sourceLanguage,
    })
    const result = await aiService.translateInput(content, translationSettings.sourceLanguage)
    log('Input translated', {
      originalLength: content.length,
      translatedLength: result.translatedContent.length,
    })
    return { promptContent: result.translatedContent, originalInput: content }
  } catch (error) {
    log('Input translation failed (non-fatal), using original', error)
    return { promptContent: content, originalInput: undefined }
  }
}

// ============================================================================
// Controller
// ============================================================================

export class ActionInputController {
  private callbacks: ActionInputCallbacks

  // Internal state
  stopRequested = false
  activeAbortController: AbortController | null = null
  lastImageGenContext: ImageGenerationContext | null = null
  private currentActionType: ActionType = 'do'

  constructor(callbacks: ActionInputCallbacks) {
    this.callbacks = callbacks
  }

  // --------------------------------------------------------------------------
  // Core Generation
  // --------------------------------------------------------------------------

  async generateResponse(
    userActionEntryId: string,
    userActionContent: string,
    options?: { countStyleReview?: boolean; styleReviewSource?: string },
  ) {
    const countStyleReview = options?.countStyleReview ?? true
    const styleReviewSource =
      options?.styleReviewSource ?? (countStyleReview ? 'new' : 'regenerate')

    if (!story.isLoaded) return

    this.stopRequested = false
    this.activeAbortController = new AbortController()

    const visualProseMode = story.settings.visualProseMode ?? false
    const inlineImageMode = story.settings.imageGenerationMode === 'inline'
    const streamingEntryId = crypto.randomUUID()
    const narrationEntryId = crypto.randomUUID()

    this.callbacks.setGenerating(true)
    this.callbacks.clearGenerationError()
    this.callbacks.clearActionChoices(story.id!)
    this.callbacks.startStreaming(visualProseMode, streamingEntryId)

    const storyId = story.id!

    let inlineImageTracker: InlineImageTracker | null = null
    if (inlineImageMode) {
      inlineImageTracker = new InlineImageTracker(
        storyId,
        narrationEntryId,
        () => story.character.characters,
      )
    }

    // Android: start foreground service to keep process alive when backgrounded
    const useBackgroundService = this.callbacks.shouldUseBackgroundService()
    if (useBackgroundService) {
      this.callbacks.startGenerationService()
    }
    this.callbacks.resetBackgroundedFlag()

    try {
      // Populate singleton for pipeline phases to read
      story.generationContext.clearIntermediates()
      story.generationContext.userAction = {
        entryId: userActionEntryId,
        content: userActionContent,
        rawInput: userActionContent,
      }
      story.generationContext.narrationEntryId = narrationEntryId
      story.generationContext.abortSignal = this.activeAbortController.signal

      const storyPosition = story.entry.entries.length
      const activationTracker = this.callbacks.getActivationTracker(
        storyPosition,
      ) as SimpleActivationTracker

      story.generationContext.rawInput = userActionContent
      story.generationContext.actionType = this.currentActionType ?? 'do'
      story.generationContext.wasRawActionChoice = false
      story.generationContext.styleReview = this.callbacks.getLastStyleReview()
      story.generationContext.activationTracker = activationTracker

      const isCreativeWritingMode = story.mode === 'creative-writing'

      const pipeline = new GenerationPipeline()

      let fullResponse = ''
      let fullReasoning = ''
      let narrationEntry: Awaited<ReturnType<typeof story.entry.addEntry>> | null = null

      for await (const event of pipeline.execute()) {
        if (this.stopRequested) break

        const eventState: PipelineEventState = {
          fullResponse: () => fullResponse,
          fullReasoning: () => fullReasoning,
          streamingEntryId,
          visualProseMode,
          isCreativeWritingMode,
          storyId,
        }

        const persistSuggestedActions = (actions: unknown[], type: 'suggestions' | 'choices') => {
          if (narrationEntry && actions.length > 0) {
            database
              .updateStoryEntry(narrationEntry.id, {
                suggestedActions: JSON.stringify(actions),
              })
              .catch((err) =>
                console.warn(`[ActionInput] Failed to save suggested ${type} to entry:`, err),
              )
          }
        }

        const eventCallbacks: PipelineUICallbacks = {
          startStreaming: this.callbacks.startStreaming,
          appendStreamContent: this.callbacks.appendStreamContent,
          appendReasoningContent: this.callbacks.appendReasoningContent,
          setGenerationStatus: this.callbacks.setGenerationStatus,
          setSuggestionsLoading: this.callbacks.setSuggestionsLoading,
          setActionChoicesLoading: this.callbacks.setActionChoicesLoading,
          setSuggestions: (suggestions, storyId) => {
            this.callbacks.setSuggestions(suggestions, storyId ?? story.id!)
            persistSuggestedActions(suggestions, 'suggestions')
          },
          setActionChoices: (choices, storyId) => {
            this.callbacks.setActionChoices(choices, storyId ?? story.id!)
            persistSuggestedActions(choices, 'choices')
          },
          emitResponseStreaming: (chunk, accumulated) => {
            this.callbacks.emitResponseStreaming(chunk, accumulated)
          },
          emitSuggestionsReady: (suggestions) => {
            this.callbacks.emitSuggestionsReady(suggestions)
          },
        }

        handleEvent(event, eventState, eventCallbacks)

        if (event.type === 'phase_complete' && event.phase === 'retrieval') {
          this.callbacks.setLastLorebookRetrieval(
            story.generationContext.retrievalResult?.lorebookRetrievalResult ?? null,
          )
        }

        if (event.type === 'narrative_chunk') {
          fullResponse += event.content
          if (event.reasoning) fullReasoning += event.reasoning
          if (inlineImageTracker)
            inlineImageTracker.processChunk(fullResponse, story.settings.referenceMode ?? false)
        }

        if (event.type === 'phase_complete' && event.phase === 'narrative' && fullResponse.trim()) {
          this.callbacks.endStreaming()
          narrationEntry = await story.entry.addEntry(
            'narration',
            fullResponse,
            undefined,
            fullReasoning || undefined,
            narrationEntryId,
          )
          this.callbacks.emitNarrativeResponse(narrationEntry.id, fullResponse)
          if (inlineImageTracker?.hasPendingImages) await inlineImageTracker.flushToDatabase()
        }

        if (event.type === 'classification_complete' && narrationEntry) {
          eventBus.emit<ClassificationCompleteEvent>({
            type: 'ClassificationComplete',
            messageId: narrationEntry.id,
            result: event.result,
          })
          await story.classification.applyClassificationResult(event.result, narrationEntry.id)
          await story.entry.updateEntryTimeEnd(narrationEntry.id)

          if (story.settings.imageGenerationMode !== 'none') {
            const presentCharacters = story.character.characters.filter(
              (c) =>
                event.result.scene.presentCharacterNames.includes(c.name) ||
                c.relationship === 'self',
            )
            this.lastImageGenContext = {
              storyId,
              entryId: narrationEntry.id,
              narrativeResponse: fullResponse,
              userAction: userActionContent,
              presentCharacters,
              currentLocation:
                event.result.scene.currentLocationName ?? story.location.currentLocation?.name,
              chatHistory: mapChatEntries(
                story.entry.visibleEntries.filter(
                  (e) => e.type === 'user_action' || e.type === 'narration',
                ),
                { truncate: false, stripPicTags: true },
              ),
              referenceMode: story.settings.referenceMode ?? false,
            }
          }

          const translationSettings = settings.translationSettings
          if (TranslationService.shouldTranslateWorldState(translationSettings)) {
            const translationService = new WorldStateTranslationService({
              translateUIElements: aiService.translateUIElements.bind(aiService),
            })
            translationService
              .translateEntities(
                {
                  classificationResult: {
                    newCharacters: event.result.entryUpdates.newCharacters,
                    newLocations: event.result.entryUpdates.newLocations,
                    newItems: event.result.entryUpdates.newItems,
                    newStoryBeats: event.result.entryUpdates.newStoryBeats,
                  },
                  worldState: {
                    characters: story.character.characters,
                    locations: story.location.locations,
                    items: story.item.items,
                    storyBeats: story.storyBeat.storyBeats,
                  },
                  targetLanguage: translationSettings.targetLanguage,
                },
                {
                  updateCharacter: (id, data) => database.updateCharacter(id, data as any),
                  updateLocation: (id, data) => database.updateLocation(id, data as any),
                  updateItem: (id, data) => database.updateItem(id, data as any),
                  updateStoryBeat: (id, data) => database.updateStoryBeat(id, data as any),
                  refreshWorldState: story.refreshWorldState.bind(story),
                },
              )
              .catch((err) => log('World state translation failed (non-fatal)', err))
          }
        }

        if (event.type === 'phase_complete' && event.phase === 'translation' && narrationEntry) {
          const translationResult = event.result as
            | {
                translated: boolean
                translatedContent: string | null
                targetLanguage: string | null
              }
            | undefined
          if (translationResult?.translated && translationResult.translatedContent) {
            await database.updateStoryEntry(narrationEntry.id, {
              translatedContent: translationResult.translatedContent,
              translationLanguage: translationResult.targetLanguage,
            })
            await story.entry.refreshEntry(narrationEntry.id)
          }
        }

        if (event.type === 'error' && event.fatal) {
          console.error('[ActionInput] Fatal pipeline error:', event.error)
          break
        }
      }

      this.callbacks.updateActivationData(activationTracker, storyId)
      if (this.stopRequested) return

      if (!fullResponse.trim()) {
        const errorMessage = 'The AI returned an empty response after 3 attempts. Please try again.'
        const errorEntry = await story.entry.addEntry('system', errorMessage)
        this.callbacks.setGenerationError({
          message: errorMessage,
          errorEntryId: errorEntry.id,
          userActionEntryId,
          timestamp: Date.now(),
        })
        return
      }

      if (
        narrationEntry &&
        settings.systemServicesSettings.tts.enabled &&
        settings.systemServicesSettings.tts.autoPlay
      ) {
        this.callbacks.emitTTSQueued(narrationEntry.id, fullResponse)
      }

      BackgroundTaskCoordinator.run(countStyleReview, styleReviewSource).catch((err) =>
        log('Background tasks failed (non-fatal)', err),
      )

      // Android: notify user that generation completed while app was backgrounded
      if (
        this.callbacks.wasBackgroundedDuringGeneration() &&
        this.callbacks.isAppBackgrounded() &&
        settings.experimentalFeatures.generationNotifications &&
        fullResponse.trim()
      ) {
        this.callbacks.sendGenerationNotification(fullResponse, true)
      }
    } catch (error) {
      if (this.stopRequested || (error instanceof Error && error.name === 'AbortError')) return
      console.error('[ActionInput] Generation error:', error)
      const baseMessage =
        error instanceof Error ? error.message : 'Failed to generate response. Please try again.'
      const errorMessage = this.callbacks.wasBackgroundedDuringGeneration()
        ? `Generation may have been interrupted while the app was in the background. ${baseMessage}`
        : baseMessage
      const errorEntry = await story.entry.addEntry('system', `Generation failed: ${errorMessage}`)
      this.callbacks.setGenerationError({
        message: errorMessage,
        errorEntryId: errorEntry.id,
        userActionEntryId,
        timestamp: Date.now(),
      })

      // Android: notify user that generation failed while backgrounded
      if (
        this.callbacks.wasBackgroundedDuringGeneration() &&
        this.callbacks.isAppBackgrounded() &&
        settings.experimentalFeatures.generationNotifications
      ) {
        this.callbacks.sendGenerationNotification('', false)
      }
    } finally {
      this.callbacks.endStreaming()
      this.callbacks.setGenerating(false)
      this.callbacks.setGenerationStatus('')
      this.activeAbortController = null
      this.stopRequested = false

      // Android: always stop the foreground service when generation ends
      if (useBackgroundService) {
        this.callbacks.stopGenerationService()
      }
    }
  }

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  async handleSubmit(input: SubmitInput) {
    if (!story.isLoaded) return

    const {
      inputValue,
      actionType,
      isRawActionChoice,
      isCreativeWritingMode,
      actionPrefixes,
      actionSuffixes,
    } = input
    const forceFreeMode = settings.uiSettings.disableActionPrefixes

    let content: string
    if (isCreativeWritingMode || isRawActionChoice || forceFreeMode) content = inputValue
    else content = actionPrefixes[actionType] + inputValue + actionSuffixes[actionType]

    // Store the action type for generationContext
    this.currentActionType = actionType

    const embeddedImages = await database.getEmbeddedImagesForStory(story.id!)
    this.callbacks.createRetryBackup(
      story.id!,
      story.entry.entries,
      story.character.characters,
      story.location.locations,
      story.item.items,
      story.storyBeat.storyBeats,
      embeddedImages,
      content,
      inputValue,
      actionType,
      isRawActionChoice,
      story.time.timeTracker,
    )

    const { promptContent, originalInput } = await translateUserInput(
      content,
      settings.translationSettings,
    )

    const userActionEntry = await story.entry.addEntry('user_action', promptContent)

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.entry.refreshEntry(userActionEntry.id)
    }

    this.callbacks.emitUserInput(
      content,
      isCreativeWritingMode ? 'direction' : forceFreeMode ? 'free' : actionType,
    )
    await tick()

    await this.generateResponse(userActionEntry.id, content)
  }

  // --------------------------------------------------------------------------
  // Stop Generation
  // --------------------------------------------------------------------------

  async handleStopGeneration(): Promise<{
    restoredActionType?: ActionType
    restoredWasRawActionChoice?: boolean
    restoredRawInput?: string
  }> {
    if (this.callbacks.isRetryingLastMessage()) return {}

    this.stopRequested = true
    this.activeAbortController?.abort()
    this.callbacks.endStreaming()
    this.callbacks.setGenerating(false)

    const backup = this.callbacks.getRetryBackup()
    if (!backup || !story.isLoaded || backup.storyId !== story.id) {
      if (backup) this.callbacks.clearRetryBackup()
      return {}
    }

    this.callbacks.clearGenerationError()
    this.callbacks.clearSuggestions(story.id!)
    this.callbacks.clearActionChoices(story.id!)

    if (backup.hasFullState) {
      this.callbacks.restoreActivationData(backup.activationData, backup.storyPosition)
    }
    this.callbacks.setLastLorebookRetrieval(null)

    const result = await retryService.handleStopGeneration(
      backup,
      {
        restoreFromRetryBackup: story.retry.restoreFromRetryBackup.bind(story.retry),
        deleteEntriesFromPosition: story.entry.deleteEntriesFromPosition.bind(story.entry),
        deleteEntitiesCreatedAfterBackup: story.entry.deleteEntitiesCreatedAfterBackup.bind(
          story.entry,
        ),
        restoreCharacterSnapshots: story.character.restoreCharacterSnapshots.bind(story.character),
        restoreTimeTrackerSnapshot: story.time.restoreTimeTrackerSnapshot.bind(story.time),
        lockRetryInProgress: story.retry.lockRetryInProgress.bind(story.retry),
        unlockRetryInProgress: story.retry.unlockRetryInProgress.bind(story.retry),
        restoreActivationData: this.callbacks.restoreActivationData,
        clearActivationData: () => this.callbacks.clearActivationData(),
        setLastLorebookRetrieval: this.callbacks.setLastLorebookRetrieval,
      },
      {
        clearGenerationError: () => this.callbacks.clearGenerationError(),
        clearSuggestions: () => this.callbacks.clearSuggestions(story.id!),
        clearActionChoices: () => this.callbacks.clearActionChoices(story.id!),
      },
    )

    let restoredValues: {
      restoredActionType?: ActionType
      restoredWasRawActionChoice?: boolean
      restoredRawInput?: string
    } = {}

    if (result.success) {
      await tick()
      restoredValues = {
        restoredActionType: result.restoredActionType as ActionType | undefined,
        restoredWasRawActionChoice: result.restoredWasRawActionChoice ?? false,
        restoredRawInput: result.restoredRawInput ?? '',
      }
    }
    this.callbacks.clearRetryBackup(true)
    return restoredValues
  }

  // --------------------------------------------------------------------------
  // Retry
  // --------------------------------------------------------------------------

  async handleRetry() {
    const error = this.callbacks.getLastGenerationError()
    if (!error) return

    const userActionEntry = story.entry.entries.find((e) => e.id === error.userActionEntryId)
    if (!userActionEntry) {
      this.callbacks.clearGenerationError()
      return
    }

    await story.entry.deleteEntry(error.errorEntryId)
    this.callbacks.clearGenerationError()

    await this.generateResponse(userActionEntry.id, userActionEntry.content, {
      countStyleReview: false,
      styleReviewSource: 'retry-error',
    })
  }

  // --------------------------------------------------------------------------
  // Retry Last Message
  // --------------------------------------------------------------------------

  async handleRetryLastMessage() {
    const backup = this.callbacks.getRetryBackup()
    if (!backup || !story.isLoaded) return
    if (backup.storyId !== story.id) {
      this.callbacks.clearRetryBackup(false)
      return
    }

    const storyId = story.id!

    this.callbacks.clearGenerationError()
    this.callbacks.clearSuggestions(storyId)
    this.callbacks.clearActionChoices(storyId)
    this.lastImageGenContext = null
    this.callbacks.setLastLorebookRetrieval(null)

    const result = await retryService.handleRetryLastMessage(
      backup,
      {
        restoreFromRetryBackup: story.retry.restoreFromRetryBackup.bind(story.retry),
        deleteEntriesFromPosition: story.entry.deleteEntriesFromPosition.bind(story.entry),
        deleteEntitiesCreatedAfterBackup: story.entry.deleteEntitiesCreatedAfterBackup.bind(
          story.entry,
        ),
        restoreCharacterSnapshots: story.character.restoreCharacterSnapshots.bind(story.character),
        restoreTimeTrackerSnapshot: story.time.restoreTimeTrackerSnapshot.bind(story.time),
        lockRetryInProgress: story.retry.lockRetryInProgress.bind(story.retry),
        unlockRetryInProgress: story.retry.unlockRetryInProgress.bind(story.retry),
        restoreActivationData: this.callbacks.restoreActivationData,
        clearActivationData: () => this.callbacks.clearActivationData(),
        setLastLorebookRetrieval: this.callbacks.setLastLorebookRetrieval,
      },
      {
        clearGenerationError: () => this.callbacks.clearGenerationError(),
        clearSuggestions: () => this.callbacks.clearSuggestions(storyId),
        clearActionChoices: () => this.callbacks.clearActionChoices(storyId),
        clearImageContext: () => {
          this.lastImageGenContext = null
        },
      },
    )

    if (!result.success) return

    await tick()

    const isCreativeWritingMode = story.mode === 'creative-writing'

    const { promptContent, originalInput } = await translateUserInput(
      backup.userActionContent,
      settings.translationSettings,
    )
    const userActionEntry = await story.entry.addEntry('user_action', promptContent)

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.entry.refreshEntry(userActionEntry.id)
    }

    this.callbacks.emitUserInput(
      backup.userActionContent,
      isCreativeWritingMode ? 'direction' : backup.actionType,
    )
    await tick()

    this.callbacks.setRetryingLastMessage(true)
    try {
      await this.generateResponse(userActionEntry.id, promptContent, {
        countStyleReview: false,
        styleReviewSource: 'retry-last-message',
      })
    } finally {
      this.callbacks.setRetryingLastMessage(false)
    }
  }

  // --------------------------------------------------------------------------
  // Suggestions
  // --------------------------------------------------------------------------

  async regenerateActionsAfterDelete() {
    if (!story.isLoaded || story.entry.entries.length === 0) return

    const storyMode = story.mode

    if (storyMode === 'creative-writing') {
      await this.refreshSuggestions()
    } else if (storyMode === 'adventure') {
      if (settings.uiSettings.disableSuggestions) return

      this.callbacks.setActionChoicesLoading(true)
      try {
        const lastNarration = [...story.entry.entries].reverse().find((e) => e.type === 'narration')
        if (!lastNarration) {
          this.callbacks.setActionChoicesLoading(false)
          return
        }

        const result = await aiService.generateActionChoices()

        if (result.choices.length > 0) {
          this.callbacks.setActionChoices(result.choices, story.id!)
          database
            .updateStoryEntry(lastNarration.id, {
              suggestedActions: JSON.stringify(result.choices),
            })
            .catch((err) =>
              console.warn('[ActionInput] Failed to save regenerated action choices:', err),
            )
        }
      } catch (error) {
        console.warn('[ActionInput] Failed to regenerate action choices after delete:', error)
      } finally {
        this.callbacks.setActionChoicesLoading(false)
      }
    }
  }

  async refreshSuggestions() {
    if (!story.isLoaded) return

    if (story.mode !== 'creative-writing' || story.entry.entries.length === 0) {
      this.callbacks.clearSuggestions(story.id!)
      return
    }

    this.callbacks.setSuggestionsLoading(true)
    try {
      const service = new SuggestionsRefreshService({
        generateSuggestions: aiService.generateSuggestions.bind(aiService),
        translateSuggestions: aiService.translateSuggestions.bind(aiService),
      })
      const result = await service.refresh({
        translationSettings: settings.translationSettings,
      })
      this.callbacks.setSuggestions(result.suggestions, story.id!)
      this.callbacks.emitSuggestionsReady(
        result.suggestions.map((s) => ({ text: s.text, type: s.type })),
      )
      // Persist refreshed suggestions to the latest narration entry for time-travel restore
      const lastNarration = [...story.entry.entries].reverse().find((e) => e.type === 'narration')
      if (lastNarration && result.suggestions.length > 0) {
        database
          .updateStoryEntry(lastNarration.id, {
            suggestedActions: JSON.stringify(result.suggestions),
          })
          .catch((err) =>
            console.warn('[ActionInput] Failed to save refreshed suggestions to entry:', err),
          )
      }
    } catch (error) {
      log('Failed to generate suggestions:', error)
      this.callbacks.clearSuggestions(story.id!)
    } finally {
      this.callbacks.setSuggestionsLoading(false)
    }
  }
}
