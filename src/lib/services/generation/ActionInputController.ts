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
 * Reads directly from store singletons (story, settings, ui) for state.
 */

import { tick } from 'svelte'
import { story } from '$lib/stores/story/index.svelte'
import { settings } from '$lib/stores/settings.svelte'
import { aiService } from '$lib/services/ai'
import { database } from '$lib/services/database'
import { SimpleActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import { TranslationService } from '$lib/services/ai/utils/TranslationService'
import {
  GenerationPipeline,
  retryService,
  BackgroundTaskCoordinator,
  WorldStateTranslationService,
  handleEvent,
  SuggestionsRefreshService,
} from '$lib/services/generation'
import type { PipelineEventState } from '$lib/services/generation'
import { InlineImageTracker } from '$lib/services/ai/image'
import {
  eventBus,
  emitNarrativeResponse,
  emitUserInput,
  emitSuggestionsReady,
  emitTTSQueued,
} from '$lib/services/events'
import type { ClassificationCompleteEvent } from '$lib/services/events'
import { ui } from '$lib/stores/ui.svelte'
import { isAndroid } from '$lib/utils/platform'

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
  sendGenerationNotification: (text: string, success: boolean) => void
}

// ============================================================================
// Static helpers
// ============================================================================

export async function translateUserInput(): Promise<{
  promptContent: string
  originalInput: string | undefined
}> {
  const translationSettings = settings.translationSettings
  const content = story.generationContext.userActionOriginal!
  if (!TranslationService.shouldTranslateInput(translationSettings)) {
    return { promptContent: content, originalInput: undefined }
  }

  try {
    log('Translating user input', {
      sourceLanguage: translationSettings.sourceLanguage,
    })
    const result = await aiService.translateInput()
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

const sendGenerationNotification = async (responseText: string, success: boolean) => {
  try {
    const { sendNotification, isPermissionGranted } =
      await import('@tauri-apps/plugin-notification')
    const permitted = await isPermissionGranted()
    if (!permitted) return

    if (success) {
      const body =
        settings.experimentalFeatures.notificationPreview && responseText.length > 0
          ? responseText.slice(0, 120).replace(/[<>]/g, '') + (responseText.length > 120 ? '…' : '')
          : 'Tap to return to your story.'
      sendNotification({ title: 'Story generation complete', body })
    } else {
      sendNotification({
        title: 'Story generation failed',
        body: 'Tap to return and retry.',
      })
    }
  } catch (e) {
    console.warn('[ActionInput] Failed to send notification:', e)
  }
}

// ============================================================================
// Controller
// ============================================================================

export class ActionInputController {
  // Internal state
  stopRequested = false
  activeAbortController: AbortController | null = null
  private currentActionType: ActionType = 'do'

  // --------------------------------------------------------------------------
  // Core Generation
  // --------------------------------------------------------------------------

  async generateResponse(options?: { countStyleReview?: boolean; styleReviewSource?: string }) {
    const userActionContent = story.generationContext.userAction?.content ?? ''
    const userActionEntryId = story.generationContext.userAction?.entryId ?? ''
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

    ui.setGenerating(true)
    ui.clearGenerationError()
    ui.clearActionChoices(story.id!)
    ui.startStreaming(visualProseMode, streamingEntryId)

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
    const useBackgroundService = isAndroid() && settings.experimentalFeatures.backgroundGeneration
    if (useBackgroundService) {
      try {
        window.AndroidBridge?.startGenerationService()
      } catch (e) {
        console.warn('[ActionInput] Failed to start generation foreground service:', e)
      }
    }
    ui.resetBackgroundedFlag()

    try {
      story.generationContext.narrationEntryId = narrationEntryId
      story.generationContext.abortSignal = this.activeAbortController.signal

      const storyPosition = story.entry.rawEntries.length
      const activationTracker = ui.getActivationTracker(storyPosition) as SimpleActivationTracker

      story.generationContext.rawInput = userActionContent
      story.generationContext.actionType = this.currentActionType ?? 'do'
      story.generationContext.wasRawActionChoice = false
      story.generationContext.styleReview = ui.lastStyleReview
      story.generationContext.activationTracker = activationTracker

      await story.generationContext.loadPackVariables()
      await story.generationContext.loadStylePrompt()

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

        handleEvent(event, eventState)

        if (event.type === 'phase_complete' && event.phase === 'retrieval') {
          ui.setLastLorebookRetrieval(
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
          ui.endStreaming()
          narrationEntry = await story.entry.addEntry(
            'narration',
            fullResponse,
            undefined,
            fullReasoning || undefined,
            narrationEntryId,
          )
          emitNarrativeResponse(narrationEntry.id, fullResponse)
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

          const translationSettings = settings.translationSettings
          if (TranslationService.shouldTranslateWorldState(translationSettings)) {
            const translationService = new WorldStateTranslationService()
            translationService
              .translateEntities()
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

      ui.updateActivationData(activationTracker, storyId)
      if (this.stopRequested) return

      if (!fullResponse.trim()) {
        const errorMessage = 'The AI returned an empty response after 3 attempts. Please try again.'
        const errorEntry = await story.entry.addEntry('system', errorMessage)
        ui.setGenerationError({
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
        emitTTSQueued(narrationEntry.id, fullResponse)
      }

      BackgroundTaskCoordinator.run(countStyleReview, styleReviewSource).catch((err) =>
        log('Background tasks failed (non-fatal)', err),
      )

      // Android: notify user that generation completed while app was backgrounded
      if (
        ui.wasBackgroundedDuringGeneration &&
        ui.isAppBackgrounded &&
        settings.experimentalFeatures.generationNotifications &&
        fullResponse.trim()
      ) {
        sendGenerationNotification(fullResponse, true)
      }
    } catch (error) {
      if (this.stopRequested || (error instanceof Error && error.name === 'AbortError')) return
      console.error('[ActionInput] Generation error:', error)
      const baseMessage =
        error instanceof Error ? error.message : 'Failed to generate response. Please try again.'
      const errorMessage = ui.wasBackgroundedDuringGeneration
        ? `Generation may have been interrupted while the app was in the background. ${baseMessage}`
        : baseMessage
      const errorEntry = await story.entry.addEntry('system', `Generation failed: ${errorMessage}`)
      ui.setGenerationError({
        message: errorMessage,
        errorEntryId: errorEntry.id,
        userActionEntryId,
        timestamp: Date.now(),
      })

      // Android: notify user that generation failed while backgrounded
      if (
        ui.wasBackgroundedDuringGeneration &&
        ui.isAppBackgrounded &&
        settings.experimentalFeatures.generationNotifications
      ) {
        sendGenerationNotification('', false)
      }
    } finally {
      ui.endStreaming()
      ui.setGenerating(false)
      ui.setGenerationStatus('')
      this.activeAbortController = null
      this.stopRequested = false

      // Android: always stop the foreground service when generation ends
      if (useBackgroundService) {
        try {
          window.AndroidBridge?.stopGenerationService()
        } catch (e) {
          console.warn('[ActionInput] Failed to stop generation foreground service:', e)
        }
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
    ui.createRetryBackup(
      story.id!,
      story.entry.rawEntries,
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
    story.generationContext.clearIntermediates()
    story.generationContext.userActionOriginal = content
    const { promptContent, originalInput } = await translateUserInput()

    const userActionEntry = await story.entry.addEntry('user_action', promptContent)

    story.generationContext.userAction = {
      entryId: userActionEntry.id,
      content: promptContent,
      rawInput: promptContent,
    }

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.entry.refreshEntry(userActionEntry.id)
    }

    emitUserInput(
      content,
      isCreativeWritingMode ? 'direction' : forceFreeMode ? 'free' : actionType,
    )
    await tick()

    await this.generateResponse()
  }

  // --------------------------------------------------------------------------
  // Stop Generation
  // --------------------------------------------------------------------------

  async handleStopGeneration(): Promise<{
    restoredActionType?: ActionType
    restoredWasRawActionChoice?: boolean
    restoredRawInput?: string
  }> {
    if (ui.isRetryingLastMessage) return {}

    this.stopRequested = true
    this.activeAbortController?.abort()
    ui.endStreaming()
    ui.setGenerating(false)

    const backup = ui.retryBackup
    if (!backup || !story.isLoaded || backup.storyId !== story.id) {
      if (backup) ui.clearRetryBackup()
      return {}
    }

    ui.clearGenerationError()
    ui.clearSuggestions(story.id!)
    ui.clearActionChoices(story.id!)

    if (backup.hasFullState) {
      ui.restoreActivationData(backup.activationData, backup.storyPosition)
    }
    ui.setLastLorebookRetrieval(null)

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
        restoreActivationData: ui.restoreActivationData.bind(ui),
        clearActivationData: () => ui.clearActivationData(),
        setLastLorebookRetrieval: ui.setLastLorebookRetrieval.bind(ui),
      },
      {
        clearGenerationError: () => ui.clearGenerationError(),
        clearSuggestions: () => ui.clearSuggestions(story.id!),
        clearActionChoices: () => ui.clearActionChoices(story.id!),
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
    ui.clearRetryBackup(true)
    return restoredValues
  }

  // --------------------------------------------------------------------------
  // Retry
  // --------------------------------------------------------------------------

  async handleRetry() {
    const error = ui.lastGenerationError
    if (!error) return

    const userActionEntry = story.entry.rawEntries.find((e) => e.id === error.userActionEntryId)
    if (!userActionEntry) {
      ui.clearGenerationError()
      return
    }

    await story.entry.deleteEntry(error.errorEntryId)
    ui.clearGenerationError()

    story.generationContext.userAction = {
      entryId: userActionEntry.id,
      content: userActionEntry.content,
      rawInput: userActionEntry.content,
    }

    await this.generateResponse({
      countStyleReview: false,
      styleReviewSource: 'retry-error',
    })
  }

  // --------------------------------------------------------------------------
  // Retry Last Message
  // --------------------------------------------------------------------------

  async handleRetryLastMessage() {
    const backup = ui.retryBackup
    if (!backup || !story.isLoaded) return
    if (backup.storyId !== story.id) {
      ui.clearRetryBackup(false)
      return
    }

    const storyId = story.id!

    ui.clearGenerationError()
    ui.clearSuggestions(storyId)
    ui.clearActionChoices(storyId)
    ui.setLastLorebookRetrieval(null)

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
        restoreActivationData: ui.restoreActivationData.bind(ui),
        clearActivationData: () => ui.clearActivationData(),
        setLastLorebookRetrieval: ui.setLastLorebookRetrieval.bind(ui),
      },
      {
        clearGenerationError: () => ui.clearGenerationError(),
        clearSuggestions: () => ui.clearSuggestions(storyId),
        clearActionChoices: () => ui.clearActionChoices(storyId),
        clearImageContext: () => {},
      },
    )

    if (!result.success) return

    await tick()

    const isCreativeWritingMode = story.mode === 'creative-writing'
    story.generationContext.userActionOriginal = backup.userActionContent
    const { promptContent, originalInput } = await translateUserInput()
    const userActionEntry = await story.entry.addEntry('user_action', promptContent)

    story.generationContext.userAction = {
      entryId: userActionEntry.id,
      content: promptContent,
      rawInput: promptContent,
    }

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.entry.refreshEntry(userActionEntry.id)
    }

    emitUserInput(backup.userActionContent, isCreativeWritingMode ? 'direction' : backup.actionType)
    await tick()

    ui.setRetryingLastMessage(true)
    try {
      await this.generateResponse({
        countStyleReview: false,
        styleReviewSource: 'retry-last-message',
      })
    } finally {
      ui.setRetryingLastMessage(false)
    }
  }

  // --------------------------------------------------------------------------
  // Suggestions
  // --------------------------------------------------------------------------

  async regenerateActionsAfterDelete() {
    if (!story.isLoaded || story.entry.rawEntries.length === 0) return

    const storyMode = story.mode

    if (storyMode === 'creative-writing') {
      await this.refreshSuggestions()
    } else if (storyMode === 'adventure') {
      if (settings.uiSettings.disableSuggestions) return

      ui.setActionChoicesLoading(true)
      try {
        const lastNarration = [...story.entry.rawEntries]
          .reverse()
          .find((e) => e.type === 'narration')
        if (!lastNarration) {
          ui.setActionChoicesLoading(false)
          return
        }

        const result = await aiService.generateActionChoices()

        if (result.choices.length > 0) {
          ui.setActionChoices(result.choices, story.id!)
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
        ui.setActionChoicesLoading(false)
      }
    }
  }

  async refreshSuggestions() {
    if (!story.isLoaded) return

    if (story.mode !== 'creative-writing' || story.entry.rawEntries.length === 0) {
      ui.clearSuggestions(story.id!)
      return
    }

    ui.setSuggestionsLoading(true)
    try {
      const service = new SuggestionsRefreshService()
      const result = await service.refresh()
      ui.setSuggestions(result.suggestions, story.id!)
      emitSuggestionsReady(result.suggestions.map((s) => ({ text: s.text, type: s.type })))
      // Persist refreshed suggestions to the latest narration entry for time-travel restore
      const lastNarration = [...story.entry.rawEntries]
        .reverse()
        .find((e) => e.type === 'narration')
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
      ui.clearSuggestions(story.id!)
    } finally {
      ui.setSuggestionsLoading(false)
    }
  }
}
