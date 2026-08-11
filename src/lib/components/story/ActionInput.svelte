<script lang="ts">
  import { tick } from 'svelte'
  import { ui, type RetrievalCacheKey } from '$lib/stores/ui.svelte'
  import { toRetrievalSnapshot } from '$lib/services/ai/retrieval'
  import { countTokens } from '$lib/services/tokenizer'
  import { story } from '$lib/stores/story.svelte'
  import { settings } from '$lib/stores/settings.svelte'
  import type { EntryMetadata } from '$lib/types'
  import { aiService } from '$lib/services/ai'
  import { database } from '$lib/services/database'
  import { SimpleActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
  import { TranslationService } from '$lib/services/ai/utils/TranslationService'
  import {
    Send,
    Wand2,
    MessageSquare,
    Brain,
    Sparkles,
    RefreshCw,
    X,
    PenLine,
    Square,
  } from '@lucide/svelte'
  import Suggestions from './Suggestions.svelte'
  import GrammarCheck from './GrammarCheck.svelte'
  import {
    emitUserInput,
    emitNarrativeResponse,
    emitSuggestionsReady,
    emitTTSQueued,
    eventBus,
    type ResponseStreamingEvent,
    type ClassificationCompleteEvent,
  } from '$lib/services/events'
  import { isTouchDevice } from '$lib/utils/swipe'
  import { isAndroid } from '$lib/utils/platform'
  import { findPrecedingUserAction } from '$lib/utils/storyEntries'
  import { errMessage } from '$lib/utils/error'
  import {
    GenerationPipeline,
    retryService,
    BackgroundTaskCoordinator,
    WorldStateTranslationService,
    handleEvent,
    SuggestionsRefreshService,
    buildLoreManagementCallbacks,
    buildLoreManagementUICallbacks,
    type PipelineDependencies,
    type PipelineConfig,
    type GenerationContext,
    type RetrievalResult,
    type BackgroundTaskDependencies,
    type BackgroundTaskInput,
    type PipelineUICallbacks,
    type PipelineEventState,
  } from '$lib/services/generation'
  import { InlineImageTracker } from '$lib/services/ai/image'

  function log(...args: any[]) {
    console.log('[ActionInput]', ...args)
  }

  // ============================================================================
  // Translation Helper
  // ============================================================================

  async function translateUserInput(
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
  // UI State
  // ============================================================================

  let inputValue = $state('')
  let actionType = $state<'do' | 'say' | 'think' | 'story' | 'free'>('do')
  let isRawActionChoice = $state(false)
  let stopRequested = false
  let activeAbortController: AbortController | null = null
  let textareaRef: HTMLTextAreaElement | null = $state(null)

  // ============================================================================
  // Derived State
  // ============================================================================

  const isCreativeMode = $derived(story.storyMode === 'creative-writing')

  const sendKeyHint = $derived(
    isTouchDevice() ? 'Shift+Enter to send' : 'Enter to send, Shift+Enter for new line',
  )

  // Block generation when any service is missing a model or has an invalid profile
  const blockGeneration = $derived(settings.hasGenerationConfigIssues)

  // ============================================================================
  // Action Type Configuration
  // ============================================================================

  type ActionType = 'do' | 'say' | 'think' | 'story' | 'free'

  const actionIcons = {
    do: Wand2,
    say: MessageSquare,
    think: Brain,
    story: Sparkles,
    free: PenLine,
  }
  const actionLabels: Record<ActionType, string> = {
    do: 'Do',
    say: 'Say',
    think: 'Think',
    story: 'Story',
    free: 'Free',
  }
  const actionBorderColors: Record<ActionType, string> = {
    do: 'border-l-emerald-500',
    say: 'border-l-blue-500',
    think: 'border-l-purple-500',
    story: 'border-l-amber-500',
    free: 'border-l-surface-600',
  }
  const actionActiveStyles: Record<ActionType, string> = {
    do: 'bg-emerald-500/15 text-emerald-400',
    say: 'bg-blue-500/15 text-blue-400',
    think: 'bg-purple-500/15 text-purple-400',
    story: 'bg-amber-500/15 text-amber-400',
    free: 'bg-surface-600/30 text-surface-300',
  }
  const actionButtonStyles: Record<ActionType, string> = {
    do: 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10',
    say: 'text-blue-400 hover:text-blue-300 hover:bg-blue-500/10',
    think: 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10',
    story: 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10',
    free: 'text-surface-400 hover:text-surface-200 hover:bg-surface-500/10',
  }
  const actionTypes: ActionType[] = ['do', 'say', 'think', 'story', 'free']

  // POV-based prefixes/suffixes
  const protagonistName = $derived.by(
    () => story.characters.find((c) => c.relationship === 'self')?.name ?? 'The protagonist',
  )
  const pov = $derived(story.pov)

  const actionPrefixes = $derived.by(() => {
    switch (pov) {
      case 'third':
        return {
          do: `${protagonistName} `,
          say: `${protagonistName} says, "`,
          think: `${protagonistName} thinks, "`,
          story: '',
          free: '',
        }
      default:
        return {
          do: 'I ',
          say: 'I say, "',
          think: 'I think to myself, "',
          story: '',
          free: '',
        }
    }
  })
  const actionSuffixes = { do: '', say: '"', think: '"', story: '', free: '' }

  // ============================================================================
  // Effects
  // ============================================================================

  $effect(() => {
    ui.setRetryCallback(handleRetry)
    return () => ui.setRetryCallback(null)
  })

  $effect(() => {
    ui.setRetryLastMessageCallback(handleRetryLastMessage)
    return () => ui.setRetryLastMessageCallback(null)
  })

  $effect(() => {
    ui.setRegenerateNarrationCallback(handleRegenerateNarration)
    return () => ui.setRegenerateNarrationCallback(null)
  })

  $effect(() => {
    const pendingAction = ui.pendingActionChoice
    if (pendingAction && !ui.isGenerating) {
      inputValue = pendingAction
      isRawActionChoice = true
      ui.clearPendingActionChoice()
    }
  })

  // Auto-regenerate suggestions/actions after time-travel delete when no saved actions found
  $effect(() => {
    if (ui.suggestionsRegenerationNeeded && !ui.isGenerating && story.entries.length > 0) {
      ui.suggestionsRegenerationNeeded = false
      regenerateActionsAfterDelete()
    }
  })

  // ============================================================================
  // Builder Functions
  // ============================================================================

  function buildPipelineDependencies(): PipelineDependencies {
    return {
      shouldUseAgenticRetrieval: () =>
        aiService.shouldUseAgenticRetrieval(settings.systemServicesSettings.timelineFill),
      runAgenticRetrieval: (options) =>
        aiService.runAgenticRetrieval({
          ...options,
          getChapterEntries: story.getChapterEntries.bind(story),
          getUnchapterizedEntries: story.getUnchapterizedEntries.bind(story),
        }),
      // The chapter-read budget is derived from this story's own chapterization threshold, so
      // it is bound here with the rest of the store rather than read from settings: a chapter
      // is about `tokenThreshold` tokens by construction. See `story.chapterReadBudget`.
      runTimelineFill: (visibleEntries, chapters, alreadyInContext) =>
        aiService.runTimelineFill(
          visibleEntries,
          chapters,
          story.getChapterEntries.bind(story),
          alreadyInContext,
          story.chapterReadBudget,
        ),
      answerChapterQuestion: (chapterNumber, question, chapters) =>
        aiService.answerChapterQuestion(
          chapterNumber,
          question,
          chapters,
          story.getChapterEntries.bind(story),
          story.chapterReadBudget,
        ),
      buildWorldStateContext: (worldState, userInput, recentEntries, options) =>
        aiService.buildWorldStateContext(worldState, userInput, recentEntries, undefined, options),
      getRelevantLorebookEntries: aiService.getRelevantLorebookEntries.bind(aiService),
      streamNarrative: aiService.streamNarrative.bind(aiService),
      classifyResponse: aiService.classifyResponse.bind(aiService),
      translateNarration: aiService.translateNarration.bind(aiService),
      generateImagesForNarrative: (ctx) =>
        aiService.generateImagesForNarrative({
          ...ctx,
          imageGenerationMode: story.currentStory?.settings?.imageGenerationMode,
          allCharacters: story.characters,
          imageSettings: settings.systemServicesSettings.imageGeneration,
          getImageProfile: (id) => settings.getImageProfile(id),
        }),
      isImageGenerationEnabled: (storySettings, type) =>
        aiService.isImageGenerationEnabled(storySettings, type),
      generateSuggestions: aiService.generateSuggestions.bind(aiService),
      translateSuggestions: aiService.translateSuggestions.bind(aiService),
      generateActionChoices: aiService.generateActionChoices.bind(aiService),
      translateActionChoices: aiService.translateActionChoices.bind(aiService),
      analyzeBackgroundChangeAndGenerateImage: (storyId, visibleEntries) =>
        aiService.analyzeBackgroundChangeAndGenerateImage(
          storyId,
          visibleEntries,
          story.updateCurrentBackgroundImage.bind(story),
        ),
    }
  }

  function buildBackgroundTaskDependencies(): BackgroundTaskDependencies {
    return {
      chapterService: {
        analyzeForChapter: aiService.analyzeForChapter.bind(aiService),
        summarizeChapter: aiService.summarizeChapter.bind(aiService),
        getNextChapterNumber: story.getNextChapterNumber.bind(story),
        addChapter: story.addChapter.bind(story),
      },
      loreManagement: {
        runLoreManagement: aiService.runLoreManagement.bind(aiService),
      },
      styleReview: { analyzeStyle: aiService.analyzeStyle.bind(aiService) },
    }
  }

  function buildBackgroundTaskInput(
    countStyleReview: boolean,
    styleReviewSource: string,
  ): BackgroundTaskInput {
    const storyId = story.currentStory?.id ?? ''
    const mode = story.currentStory?.mode ?? 'adventure'

    return {
      styleReview: {
        storyId,
        entries: story.entries,
        mode,
        pov: story.pov,
        tense: story.tense,
        enabled: settings.systemServicesSettings.styleReviewer.enabled,
        triggerInterval: settings.systemServicesSettings.styleReviewer.triggerInterval,
        recentEntriesCount: settings.systemServicesSettings.styleReviewer.recentEntriesCount,
        currentCounter: ui.messagesSinceLastStyleReview,
        shouldIncrement: countStyleReview,
        source: styleReviewSource,
      },
      styleReviewCallbacks: {
        incrementCounter: ui.incrementStyleReviewCounter.bind(ui),
        setLoading: ui.setStyleReviewLoading.bind(ui),
        setResult: ui.setStyleReview.bind(ui),
      },
      chapterCheck: {
        storyId,
        currentBranchId: story.currentStory?.currentBranchId ?? null,
        entries: story.entries,
        lastChapterEndIndex: story.lastChapterEndIndex,
        tokensSinceLastChapter: story.tokensSinceLastChapter,
        tokensOutsideBuffer: story.tokensOutsideBuffer,
        messagesSinceLastChapter: story.messagesSinceLastChapter,
        memoryConfig: story.memoryConfig,
        currentBranchChapters: story.currentBranchChapters,
        mode,
        pov: story.pov,
        tense: story.tense,
      },
      // A thunk: read when the session starts, after the classifier and the chapter check
      // have run. See BackgroundTaskInput.loreSession.
      // `storyId` included, rather than the turn's own: the read happens seconds later, the
      // user can have switched story, and the callbacks write to whatever `currentStory` is
      // by then. A snapshot naming one story and carrying another's entries is the only
      // combination that lands lore in the wrong place.
      loreSession: () => ({
        storyId: story.currentStory?.id ?? storyId,
        currentBranchId: story.currentStory?.currentBranchId ?? null,
        lorebookEntries: story.lorebookEntries,
        chapters: story.currentBranchChapters,
        recentEntries: story.getUnchapterizedEntries(),
        mode,
        pov: story.pov,
        tense: story.tense,
      }),
      loreCallbacks: buildLoreManagementCallbacks(),
      loreUICallbacks: buildLoreManagementUICallbacks(),
    }
  }

  // ============================================================================
  // Core Generation
  // ============================================================================

  /**
   * Send an OS notification when generation completes/fails while the app is backgrounded.
   * Only called on Android when the generationNotifications experimental feature is enabled.
   * Both body and largeBody are set so Android BigTextStyle keeps preview text
   * visible in collapsed, expanded, and grouped notification states.
   */
  async function sendGenerationNotification(responseText: string, success: boolean) {
    try {
      const { sendNotification, isPermissionGranted } =
        await import('@tauri-apps/plugin-notification')
      const permitted = await isPermissionGranted()
      if (!permitted) return

      if (success) {
        const previewText =
          settings.experimentalFeatures.notificationPreview && responseText.length > 0
            ? responseText.slice(0, 120).replace(/[<>]/g, '') +
              (responseText.length > 120 ? '…' : '')
            : 'Tap to return to your story.'
        sendNotification({
          title: 'Story generation complete',
          body: previewText,
          largeBody: previewText,
        })
      } else {
        sendNotification({
          title: 'Story generation failed',
          body: 'Tap to return and retry.',
          largeBody: 'Tap to return and retry.',
        })
      }
    } catch (e) {
      console.warn('[ActionInput] Failed to send notification:', e)
    }
  }

  /** Send a failure notification if the user was backgrounded during this generation. */
  async function notifyFailureIfBackgrounded() {
    if (
      ui.wasBackgroundedDuringGeneration &&
      settings.experimentalFeatures.generationNotifications
    ) {
      await sendGenerationNotification('', false)
    }
  }

  /**
   * The key a retrieval result would be stored under right now.
   *
   * Call it once the entries are in the state generation will run from, which always means
   * *after* the user action row exists: the write site captures `story.entries.length`
   * inside `generateResponse`, by which point `addEntry` (fresh turn) or the restore
   * (retry, regenerate) has already put it there. Called any earlier it computes a position
   * one lower than the stored key and can never match.
   */
  function retrievalKeyFor(actionContent: string): RetrievalCacheKey | null {
    const current = story.currentStory
    if (!current) return null
    return {
      storyId: current.id,
      branchId: current.currentBranchId ?? null,
      position: story.entries.length,
      actionContent,
    }
  }

  async function generateResponse(
    userActionEntryId: string,
    userActionContent: string,
    options?: {
      countStyleReview?: boolean
      styleReviewSource?: string
      cachedRetrievalResult?: RetrievalResult | null
    },
  ) {
    const countStyleReview = options?.countStyleReview ?? true
    const styleReviewSource =
      options?.styleReviewSource ?? (countStyleReview ? 'new' : 'regenerate')

    if (!story.currentStory) return

    stopRequested = false
    activeAbortController = new AbortController()

    const visualProseMode = story.currentStory.settings?.visualProseMode ?? false
    const inlineImageMode = story.currentStory.settings?.imageGenerationMode === 'inline'
    const streamingEntryId = crypto.randomUUID()
    const narrationEntryId = crypto.randomUUID()

    // Snapshot the narrative generation config so we can record which model/profile/effort
    // produced this response. Captured at start to reflect the settings used for the request.
    const narrativeProfile = settings.getMainNarrativeProfile()
    const generationStartedAt = Date.now()
    const generationMeta: EntryMetadata = {
      model: settings.apiSettings.defaultModel,
      profileId: narrativeProfile?.id,
      profileName: narrativeProfile?.name,
      reasoningEffort: settings.apiSettings.reasoningEffort ?? 'none',
      temperature: settings.apiSettings.temperature,
    }

    ui.setGenerating(true)
    ui.clearGenerationError()
    ui.clearActionChoices(story.currentStory.id)
    ui.startStreaming(visualProseMode, streamingEntryId)

    const currentStoryRef = story.currentStory

    let inlineImageTracker: InlineImageTracker | null = null
    if (inlineImageMode) {
      inlineImageTracker = new InlineImageTracker(
        currentStoryRef.id,
        narrationEntryId,
        () => story.characters,
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
      const worldState = story.worldStateSnapshot

      const storyPosition = story.entries.length
      const activationTracker = ui.getActivationTracker(storyPosition) as SimpleActivationTracker
      const protagonist = story.characters.find((c) => c.relationship === 'self')

      const ctx: GenerationContext = {
        story: currentStoryRef,
        visibleEntries: story.visibleEntries,
        allEntries: story.entries,
        worldState,
        userAction: {
          entryId: userActionEntryId,
          content: userActionContent,
          rawInput: userActionContent,
        },
        narrationEntryId,
        abortSignal: activeAbortController.signal,
      }

      const cfg: PipelineConfig = {
        rawInput: userActionContent,
        actionType,
        wasRawActionChoice: false,
        memoryRetrievalEnabled: settings.systemServicesSettings.timelineFill?.enabled ?? true,
        storyMode: currentStoryRef.mode ?? 'adventure',
        pov: story.pov,
        tense: story.tense,
        // Gated on the setting, not just on the scheduler: `lastStyleReview` is persisted
        // and restored on load, so a review produced before the feature was switched off
        // would otherwise keep reaching the narrator prompt forever.
        styleReview: settings.systemServicesSettings.styleReviewer.enabled
          ? ui.lastStyleReview
          : null,
        activationTracker,
        translationSettings: settings.translationSettings,
        imageSettings: {
          imageGenerationMode: currentStoryRef.settings?.imageGenerationMode ?? 'agentic',
          backgroundImagesEnabled: currentStoryRef.settings?.backgroundImagesEnabled ?? false,
          referenceMode: currentStoryRef.settings?.referenceMode ?? false,
        },
        promptContext: {
          mode: story.storyMode,
          pov: story.pov,
          tense: story.tense,
          protagonistName: protagonist?.name || 'the protagonist',
          genre: currentStoryRef.genre ?? undefined,
          settingDescription: currentStoryRef.description ?? undefined,
          tone: currentStoryRef.settings?.tone ?? undefined,
          themes: currentStoryRef.settings?.themes ?? undefined,
        },
        disableSuggestions: settings.uiSettings.disableSuggestions,
        activeThreads: story.pendingQuests,
        cachedRetrievalResult: options?.cachedRetrievalResult ?? null,
      }

      const deps = buildPipelineDependencies()
      const pipeline = new GenerationPipeline(deps)

      let fullResponse = ''
      let fullReasoning = ''
      let narrationEntry: Awaited<ReturnType<typeof story.addEntry>> | null = null

      const eventState: PipelineEventState = {
        fullResponse: () => fullResponse,
        fullReasoning: () => fullReasoning,
        streamingEntryId,
        visualProseMode,
        isCreativeMode,
        storyId: currentStoryRef.id,
        activeParallelPhases: new Set(),
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
        startStreaming: ui.startStreaming.bind(ui),
        appendStreamContent: ui.appendStreamContent.bind(ui),
        appendReasoningContent: ui.appendReasoningContent.bind(ui),
        setGenerationStatus: ui.setGenerationStatus.bind(ui),
        setSuggestionsLoading: ui.setSuggestionsLoading.bind(ui),
        setActionChoicesLoading: ui.setActionChoicesLoading.bind(ui),
        setSuggestions: (suggestions, storyId) => {
          ui.setSuggestions(suggestions, storyId)
          persistSuggestedActions(suggestions, 'suggestions')
        },
        setActionChoices: (choices, storyId) => {
          ui.setActionChoices(choices, storyId)
          persistSuggestedActions(choices, 'choices')
        },
        emitResponseStreaming: (chunk, accumulated) => {
          eventBus.emit<ResponseStreamingEvent>({
            type: 'ResponseStreaming',
            chunk,
            accumulated,
          })
        },
        emitSuggestionsReady: (suggestions) => {
          emitSuggestionsReady(suggestions)
        },
      }

      for await (const event of pipeline.execute(ctx, cfg)) {
        if (stopRequested) break

        handleEvent(event, eventState, eventCallbacks)

        if (event.type === 'phase_complete' && event.phase === 'retrieval') {
          const retrievalResult = event.result as RetrievalResult | undefined
          ui.setLastLorebookRetrieval(
            retrievalResult?.lorebookRetrievalResult ?? null,
            retrievalResult?.worldStateRetrievalResult ?? null,
          )
          // Kept for the narration entry below: the in-memory copy dies with the session.
          generationMeta.retrievalSnapshot =
            toRetrievalSnapshot(
              retrievalResult?.lorebookRetrievalResult,
              retrievalResult?.worldStateRetrievalResult,
              countTokens,
            ) ?? undefined
          ui.setLastRetrievalResult(retrievalResult ?? null, {
            storyId: currentStoryRef.id,
            branchId: currentStoryRef.currentBranchId ?? null,
            position: storyPosition,
            actionContent: userActionContent,
          })
        }

        if (event.type === 'narrative_chunk') {
          fullResponse += event.content
          if (event.reasoning) fullReasoning += event.reasoning
          if (inlineImageTracker)
            inlineImageTracker.processChunk(
              fullResponse,
              currentStoryRef.settings?.referenceMode ?? false,
            )
        }

        if (event.type === 'phase_complete' && event.phase === 'narrative' && fullResponse.trim()) {
          generationMeta.generationTime = Date.now() - generationStartedAt
          narrationEntry = await story.addEntry(
            'narration',
            fullResponse,
            generationMeta,
            fullReasoning || undefined,
            narrationEntryId,
          )
          ui.endStreaming()
          emitNarrativeResponse(narrationEntry.id, fullResponse)
          if (inlineImageTracker?.hasPendingImages) await inlineImageTracker.flushToDatabase()
        }

        if (event.type === 'classification_complete' && narrationEntry) {
          eventBus.emit<ClassificationCompleteEvent>({
            type: 'ClassificationComplete',
            messageId: narrationEntry.id,
            result: event.result,
          })
          // A world update that failed used to be indistinguishable from a turn that
          // changed nothing: same empty result, no error, no toast. Say it happened —
          // the alternative is the player noticing a missing location three turns later.
          if (event.result._error) {
            console.error('[ActionInput] World update failed:', event.result._error)
            ui.showToast(
              'The world update failed for this response. Some or all changes were not ' +
                'applied — you can regenerate the response to try again.',
              'warning',
            )
          }
          await story.applyClassificationResult(event.result, narrationEntry.id)
          await story.updateEntryTimeEnd(narrationEntry.id)

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
                    characters: story.characters,
                    locations: story.locations,
                    items: story.items,
                    storyBeats: story.storyBeats,
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
            await story.refreshEntry(narrationEntry.id)
          }
        }

        if (event.type === 'error' && event.fatal) {
          console.error('[ActionInput] Fatal pipeline error:', event.error)
          break
        }
      }

      ui.updateActivationData(activationTracker, currentStoryRef.id)
      if (stopRequested) return

      if (!fullResponse.trim()) {
        const errorMessage = 'The AI returned an empty response after 3 attempts. Please try again.'
        const errorEntry = await story.addEntry('system', errorMessage)
        ui.setGenerationError({
          message: errorMessage,
          errorEntryId: errorEntry.id,
          userActionEntryId,
          timestamp: Date.now(),
        })

        await notifyFailureIfBackgrounded()
        return
      }

      if (
        narrationEntry &&
        settings.systemServicesSettings.tts.enabled &&
        settings.systemServicesSettings.tts.autoPlay
      ) {
        emitTTSQueued(narrationEntry.id, fullResponse)
      }

      const coordinator = new BackgroundTaskCoordinator(buildBackgroundTaskDependencies())
      const input = buildBackgroundTaskInput(countStyleReview, styleReviewSource)
      if (!story.memoryConfig.autoSummarize) input.chapterCheck.tokensOutsideBuffer = 0
      // Deliberately not awaited — but the flag has to outlive the call, or the Memory
      // view will offer to create a chapter while this one is being created.
      const bgStoryId = story.currentStory?.id ?? ''
      const bgBranchId = story.currentStory?.currentBranchId ?? null
      ui.setBackgroundTasksActive(bgStoryId, bgBranchId, true)
      coordinator
        .runBackgroundTasks(input)
        .catch((err) => log('Background tasks failed (non-fatal)', err))
        .finally(() => ui.setBackgroundTasksActive(bgStoryId, bgBranchId, false))

      // Android: notify user that generation completed while app is still backgrounded.
      // Awaited so the foreground service isn't torn down before the notification fires.
      if (
        ui.wasBackgroundedDuringGeneration &&
        ui.isAppBackgrounded &&
        settings.experimentalFeatures.generationNotifications
      ) {
        await sendGenerationNotification(fullResponse, true)
      }
    } catch (error) {
      // Only suppress handling when the user explicitly requested a stop.
      // An AbortError that arrives with stopRequested=false means the request
      // was cancelled externally (e.g. connection loss), so we still want to
      // record the error entry and send a failure notification.
      if (stopRequested) return
      console.error('[ActionInput] Generation error:', error)
      const baseMessage =
        error instanceof Error ? error.message : 'Failed to generate response. Please try again.'
      const errorMessage = ui.wasBackgroundedDuringGeneration
        ? `Generation may have been interrupted while the app was in the background. ${baseMessage}`
        : baseMessage
      const errorEntry = await story.addEntry('system', `Generation failed: ${errorMessage}`)
      ui.setGenerationError({
        message: errorMessage,
        errorEntryId: errorEntry.id,
        userActionEntryId,
        timestamp: Date.now(),
      })

      await notifyFailureIfBackgrounded()
    } finally {
      ui.endStreaming()
      ui.setGenerating(false)
      ui.setGenerationStatus('')
      activeAbortController = null

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

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Regenerate suggestions or action choices after a time-travel delete
   * when no previously saved actions were found on the restored entry.
   */
  async function regenerateActionsAfterDelete() {
    if (!story.currentStory || story.entries.length === 0) return

    const storyMode = story.storyMode

    if (storyMode === 'creative-writing') {
      // For creative-writing mode, use the existing refresh mechanism
      await refreshSuggestions()
    } else if (storyMode === 'adventure') {
      // For adventure mode, generate new action choices
      if (settings.uiSettings.disableSuggestions) return

      ui.setActionChoicesLoading(true)
      try {
        const lastNarration = [...story.entries].reverse().find((e) => e.type === 'narration')
        if (!lastNarration) {
          ui.setActionChoicesLoading(false)
          return
        }

        const protagonist = story.characters.find((c) => c.relationship === 'self')
        const promptContext: import('$lib/services/generation/phases/PostGenerationPhase').PromptContext =
          {
            mode: 'adventure',
            pov: story.pov,
            tense: story.tense,
            protagonistName: protagonist?.name || 'the protagonist',
            genre: story.currentStory.genre ?? undefined,
            settingDescription: story.currentStory.description ?? undefined,
            tone: story.currentStory.settings?.tone ?? undefined,
            themes: story.currentStory.settings?.themes ?? undefined,
          }

        const worldState = {
          characters: story.characters,
          locations: story.locations,
          items: story.items,
          storyBeats: story.storyBeats,
        }

        const lorebookEntries = story.lorebookEntries
        const result = await aiService.generateActionChoices(
          story.entries,
          worldState,
          lastNarration.content,
          lorebookEntries,
          promptContext,
          story.pov,
          story.currentStory?.id,
        )

        if (result.choices.length > 0) {
          ui.setActionChoices(result.choices, story.currentStory!.id)
          // Also save to the last narration entry for future time-travel
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

  async function refreshSuggestions() {
    if (!story.currentStory) return

    if (story.storyMode !== 'creative-writing' || story.entries.length === 0) {
      ui.clearSuggestions(story.currentStory.id)
      return
    }

    ui.setSuggestionsLoading(true)
    try {
      const service = new SuggestionsRefreshService({
        generateSuggestions: aiService.generateSuggestions.bind(aiService),
        translateSuggestions: aiService.translateSuggestions.bind(aiService),
      })
      const result = await service.refresh({
        storyId: story.currentStory.id,
        entries: story.entries,
        pendingQuests: story.pendingQuests,
        storyMode: story.storyMode,
        pov: story.pov,
        tense: story.tense,
        protagonistName,
        genre: story.currentStory.genre ?? undefined,
        settingDescription: story.currentStory.description ?? undefined,
        tone: story.currentStory.settings?.tone ?? undefined,
        themes: story.currentStory.settings?.themes ?? undefined,
        lastLorebookRetrieval: ui.lastLorebookRetrieval?.all ?? null,
        translationSettings: settings.translationSettings,
      })
      ui.setSuggestions(result.suggestions, story.currentStory.id)
      emitSuggestionsReady(result.suggestions.map((s) => ({ text: s.text, type: s.type })))
      // Persist refreshed suggestions to the latest narration entry for time-travel restore
      const lastNarration = [...story.entries].reverse().find((e) => e.type === 'narration')
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
      ui.clearSuggestions(story.currentStory.id)
    } finally {
      ui.setSuggestionsLoading(false)
    }
  }

  function handleSuggestionSelect(text: string) {
    inputValue = text
    document.querySelector('textarea')?.focus()
  }

  async function handleSubmit() {
    if (!inputValue.trim() || ui.isGenerating || !story.currentStory) return

    ui.clearGenerationError()
    ui.resetScrollBreak()
    ui.clearSuggestions(story.currentStory.id)

    const rawInput = inputValue.trim()
    const wasRawActionChoice = isRawActionChoice
    const forceFreeMode = settings.uiSettings.disableActionPrefixes

    let content: string
    if (isCreativeMode || wasRawActionChoice || forceFreeMode) content = rawInput
    else content = actionPrefixes[actionType] + rawInput + actionSuffixes[actionType]

    isRawActionChoice = false
    inputValue = ''
    if (textareaRef) textareaRef.scrollTop = 0

    const embeddedImageIds = await database.getEmbeddedImageIdsForStory(story.currentStory.id)
    ui.createRetryBackup(
      story.currentStory.id,
      story.entries,
      story.characters,
      story.locations,
      story.items,
      story.storyBeats,
      embeddedImageIds,
      content,
      rawInput,
      actionType,
      wasRawActionChoice,
      story.currentStory.timeTracker,
    )

    const { promptContent, originalInput } = await translateUserInput(
      content,
      settings.translationSettings,
    )

    const userActionEntry = await story.addEntry('user_action', promptContent)

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.refreshEntry(userActionEntry.id)
    }

    emitUserInput(content, isCreativeMode ? 'direction' : forceFreeMode ? 'free' : actionType)
    await tick()

    // `promptContent`, not the raw `content`: with translation on the two differ, and the
    // entry the narrator reads holds `promptContent`. Passing the raw text here left
    // retrieval and classification working from a different wording than the narration —
    // and the retry path already passes `promptContent`, so the two disagreed.
    await generateResponse(userActionEntry.id, promptContent)
  }

  async function handleStopGeneration() {
    if (stopRequested || ui.isRetryingLastMessage) return

    stopRequested = true
    activeAbortController?.abort()
    ui.endStreaming()
    ui.setGenerating(false)

    const backup = ui.retryBackup
    if (!backup || !story.currentStory || backup.storyId !== story.currentStory.id) {
      if (backup) ui.clearRetryBackup()
      return
    }

    ui.clearGenerationError()
    ui.clearSuggestions(story.currentStory.id)
    ui.clearActionChoices(story.currentStory.id)

    if (backup.hasFullState) {
      ui.restoreActivationData(backup.activationData, backup.storyPosition)
    }
    ui.setLastLorebookRetrieval(null)
    ui.setLastRetrievalResult(null)

    const result = await retryService.handleStopGeneration(
      backup,
      {
        restoreFromRetryBackup: story.restoreFromRetryBackup.bind(story),
        deleteEntriesFromPosition: story.deleteEntriesFromPosition.bind(story),
        deleteEntitiesCreatedAfterBackup: story.deleteEntitiesCreatedAfterBackup.bind(story),
        restoreCharacterSnapshots: story.restoreCharacterSnapshots.bind(story),
        restoreTimeTrackerSnapshot: story.restoreTimeTrackerSnapshot.bind(story),
        lockRetryInProgress: story.lockRetryInProgress.bind(story),
        unlockRetryInProgress: story.unlockRetryInProgress.bind(story),
        restoreActivationData: ui.restoreActivationData.bind(ui),
        clearActivationData: () => ui.clearActivationData(),
        setLastLorebookRetrieval: ui.setLastLorebookRetrieval.bind(ui),
      },
      {
        clearGenerationError: () => ui.clearGenerationError(),
        clearSuggestions: () => ui.clearSuggestions(story.currentStory!.id),
        clearActionChoices: () => ui.clearActionChoices(story.currentStory!.id),
      },
    )

    if (result.success) {
      await tick()
      actionType = (result.restoredActionType as ActionType) ?? actionType
      isRawActionChoice = result.restoredWasRawActionChoice ?? false
      inputValue = result.restoredRawInput ?? ''
    }
    ui.clearRetryBackup(true)
  }

  async function handleRetry() {
    const error = ui.lastGenerationError
    if (!error || ui.isGenerating) return

    const userActionEntry = story.entries.find((e) => e.id === error.userActionEntryId)
    if (!userActionEntry) {
      ui.clearGenerationError()
      return
    }

    await story.deleteEntry(error.errorEntryId)
    ui.clearGenerationError()

    await generateResponse(userActionEntry.id, userActionEntry.content, {
      countStyleReview: false,
      styleReviewSource: 'retry-error',
    })
  }

  function dismissError() {
    ui.clearGenerationError()
  }

  /**
   * Regenerate a narration that has no matching retry backup. That is not the rare case
   * the name suggests: `ui.retryBackup` lives in an in-memory SvelteMap, so it is gone
   * after any app restart or story switch, and this is then the only regenerate available
   * for the last narration.
   *
   * Unlike `handleRetryLastMessage`, there is no pre-generation snapshot to restore from,
   * so the world state has to be unwound from what the entry itself recorded --
   * `undoNarrationForRegenerate`. Skipping that step let the discarded narration's
   * classification stay applied while the replacement's was added on top: story time
   * advanced twice for one user action, and entities it invented outlived it.
   */
  async function handleRegenerateNarration(entryId: string) {
    if (ui.isGenerating) return

    const userActionEntry = findPrecedingUserAction(story.entries, entryId)
    if (!userActionEntry) return

    let undo: { entitiesUndone: boolean; timeUndone: boolean }
    try {
      undo = await story.undoNarrationForRegenerate(entryId)
    } catch (error) {
      ui.showToast(errMessage(error), 'error')
      return
    }

    // Entity changes are only reversible when stateTracking recorded a delta for the
    // entry. Say so rather than leaving the user to notice a stray character later.
    if (!undo.entitiesUndone) {
      ui.showToast(
        'Regenerating: story time was restored, but characters, locations or items the ' +
          'previous response added could not be undone. Enable State Tracking in ' +
          'Experimental Features to make these reversible.',
        'warning',
      )
    }

    // The rewind above put the story back exactly where the previous turn's retrieval was
    // computed, so that result is still the right one — same branch, same position, same
    // action. Read after the undo, since the key is position-sensitive.
    const cachedRetrieval = retrievalKeyFor(userActionEntry.content)
    await generateResponse(userActionEntry.id, userActionEntry.content, {
      countStyleReview: false,
      styleReviewSource: 'regenerate',
      cachedRetrievalResult: cachedRetrieval ? ui.retrievalResultFor(cachedRetrieval) : null,
    })
  }

  async function handleRetryLastMessage() {
    const backup = ui.retryBackup
    console.log('[handleRetryLastMessage] called', {
      hasBackup: !!backup,
      isGenerating: ui.isGenerating,
    })
    if (!backup || ui.isGenerating || !story.currentStory) return
    if (backup.storyId !== story.currentStory.id) {
      ui.clearRetryBackup(false)
      return
    }

    const storyId = story.currentStory.id

    ui.clearGenerationError()
    ui.clearSuggestions(storyId)
    ui.clearActionChoices(storyId)

    const result = await retryService.handleRetryLastMessage(
      backup,
      {
        restoreFromRetryBackup: story.restoreFromRetryBackup.bind(story),
        deleteEntriesFromPosition: story.deleteEntriesFromPosition.bind(story),
        deleteEntitiesCreatedAfterBackup: story.deleteEntitiesCreatedAfterBackup.bind(story),
        restoreCharacterSnapshots: story.restoreCharacterSnapshots.bind(story),
        restoreTimeTrackerSnapshot: story.restoreTimeTrackerSnapshot.bind(story),
        lockRetryInProgress: story.lockRetryInProgress.bind(story),
        unlockRetryInProgress: story.unlockRetryInProgress.bind(story),
        restoreActivationData: ui.restoreActivationData.bind(ui),
        clearActivationData: () => ui.clearActivationData(),
        setLastLorebookRetrieval: ui.setLastLorebookRetrieval.bind(ui),
      },
      {
        clearGenerationError: () => ui.clearGenerationError(),
        clearSuggestions: () => ui.clearSuggestions(storyId),
        clearActionChoices: () => ui.clearActionChoices(storyId),
      },
    )

    if (!result.success) return

    await tick()

    const { promptContent, originalInput } = await translateUserInput(
      backup.userActionContent,
      settings.translationSettings,
    )
    const userActionEntry = await story.addEntry('user_action', promptContent)

    if (originalInput) {
      await database.updateStoryEntry(userActionEntry.id, { originalInput })
      await story.refreshEntry(userActionEntry.id)
    }

    emitUserInput(backup.userActionContent, isCreativeMode ? 'direction' : backup.actionType)
    await tick()

    // Read here rather than before the rewind: the key carries the position, so it only
    // matches once the restore has put the story back where retrieval ran.
    const cacheKey = retrievalKeyFor(promptContent)

    ui.setRetryingLastMessage(true)
    try {
      await generateResponse(userActionEntry.id, promptContent, {
        countStyleReview: false,
        styleReviewSource: 'retry-last-message',
        cachedRetrievalResult: cacheKey ? ui.retrievalResultFor(cacheKey) : null,
      })
    } finally {
      ui.setRetryingLastMessage(false)
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const isMobile = isTouchDevice()
    const shouldSubmit = isMobile
      ? event.key === 'Enter' && event.shiftKey
      : event.key === 'Enter' && !event.shiftKey
    if (shouldSubmit) {
      event.preventDefault()
      handleSubmit()
    }
  }

  function autoResize(node: HTMLTextAreaElement, _value?: string) {
    function resize() {
      node.style.height = 'auto'
      node.style.height = `${node.scrollHeight}px`
    }
    resize()
    node.addEventListener('input', resize)
    return {
      update(_newValue?: string) {
        resize()
      },
      destroy() {
        node.removeEventListener('input', resize)
      },
    }
  }
</script>

<div class="ml-1 space-y-3">
  {#if ui.lastGenerationError && !ui.isGenerating}
    <div
      class="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
    >
      <div class="flex items-center gap-2 text-sm text-red-400">
        <span>Generation failed. Would you like to try again?</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          onclick={handleRetry}
          class="btn flex items-center gap-1.5 bg-red-500/20 text-sm text-red-400 hover:bg-red-500/30"
          ><RefreshCw class="h-4 w-4" />Retry</button
        >
        <button
          onclick={dismissError}
          class="text-surface-400 hover:bg-surface-700 hover:text-surface-200 rounded p-1.5"
          title="Dismiss"><X class="h-4 w-4" /></button
        >
      </div>
    </div>
  {/if}

  <GrammarCheck text={inputValue} onApplySuggestion={(newText) => (inputValue = newText)} />

  {#if isCreativeMode}
    <div
      class="sm:border-border rounded-lg border-l-0 sm:border sm:border-l-4 sm:shadow-sm {ui.isGenerating
        ? 'sm:border-l-surface-600 bg-surface-400/5'
        : 'border-l-accent-500 bg-card'} relative transition-colors duration-200"
    >
      {#if settings.uiSettings.showWordCount}<div
          class="absolute -top-[2.05rem] -right-3 sm:hidden"
        >
          <div
            class="bg-surface-800 border-surface-500/30 text-surface-400 rounded-tl-md border border-b-0 px-2 py-0.5 text-sm"
          >
            {story.wordCount} words
          </div>
        </div>{/if}
      {#if !settings.uiSettings.disableSuggestions}<div class="border-surface-700/30 sm:border-b">
          <Suggestions
            suggestions={ui.suggestions}
            loading={ui.suggestionsLoading}
            onSelect={handleSuggestionSelect}
            onRefresh={refreshSuggestions}
          />
        </div>{/if}
      <div class="mb-3 flex items-center gap-1 sm:mb-0 sm:items-end sm:p-1">
        <div class="relative min-w-0 flex-1">
          <textarea
            bind:value={inputValue}
            bind:this={textareaRef}
            use:autoResize={inputValue}
            onkeydown={handleKeydown}
            placeholder="Describe what happens next in the story..."
            class="text-surface-200 placeholder-surface-500 max-h-40 min-h-6 w-full resize-none border-none bg-transparent px-2 text-base leading-relaxed focus:ring-0 focus:outline-none sm:min-h-6"
            rows="1"></textarea>
        </div>
        {#if ui.isGenerating}
          {#if !ui.isRetryingLastMessage}<button
              onclick={handleStopGeneration}
              class="flex h-11 w-11 flex-shrink-0 -translate-y-0.5 animate-pulse items-center justify-center rounded-lg p-0 text-red-400 transition-all hover:text-red-300 active:scale-95 sm:translate-y-0"
              title="Stop generation"><Square class="h-6 w-6" /></button
            >
          {:else}<button
              disabled
              class="flex h-11 w-11 flex-shrink-0 cursor-not-allowed items-center justify-center rounded-lg p-0 text-red-400 opacity-50"
              title="Stop disabled during retry"><Square class="h-6 w-6" /></button
            >{/if}
        {:else}<button
            onclick={handleSubmit}
            disabled={!inputValue.trim() || blockGeneration}
            class="text-accent-400 hover:text-accent-300 hover:bg-accent-500/10 flex h-11 w-11 flex-shrink-0 -translate-y-0.5 items-center justify-center rounded-lg p-0 transition-all active:scale-95 disabled:opacity-50 sm:translate-y-0"
            title={blockGeneration
              ? 'AI configuration incomplete — check Settings'
              : `Send direction (${sendKeyHint})`}><Send class="h-6 w-6" /></button
          >{/if}
      </div>
    </div>
  {:else}
    <div
      class="sm:border-border rounded-lg border-l-0 sm:border sm:border-l-4 sm:shadow-sm {ui.isGenerating
        ? 'sm:border-l-surface-60'
        : `${actionBorderColors[actionType]}`} bg-card relative transition-colors duration-200"
    >
      {#if settings.uiSettings.showWordCount}<div
          class="absolute -top-[2.05rem] -right-3 sm:hidden"
        >
          <div
            class="bg-surface-800 border-surface-500/30 text-surface-400 rounded-tl-md border border-b-0 px-2 py-0.5 text-sm"
          >
            {story.wordCount} words
          </div>
        </div>{/if}
      {#if !settings.uiSettings.disableActionPrefixes}
        <div
          class="border-surface-700/30 flex items-center gap-1 px-1 pt-0 pb-0 sm:border-b sm:px-2 sm:py-1"
        >
          {#each actionTypes as type (type)}{@const Icon = actionIcons[type]}<button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[10px] font-medium transition-all duration-150 sm:flex-none sm:px-3 sm:py-1 sm:text-xs {actionType ===
              type
                ? actionActiveStyles[type]
                : `text-surface-500 hover:${actionButtonStyles[type]}`}"
              onclick={() => (actionType = type)}
              ><Icon class="h-3 w-3 sm:h-3.5 sm:w-3.5" /><span>{actionLabels[type]}</span></button
            >{/each}
        </div>
      {/if}
      <div class="mb-3 flex items-center gap-1 sm:mb-0 sm:items-end sm:p-1">
        <div class="relative min-w-0 flex-1 self-center">
          <textarea
            bind:value={inputValue}
            bind:this={textareaRef}
            use:autoResize={inputValue}
            onkeydown={handleKeydown}
            placeholder={actionType === 'story'
              ? 'Describe what happens...'
              : actionType === 'say'
                ? 'What do you say?'
                : actionType === 'think'
                  ? 'What are you thinking?'
                  : actionType === 'free'
                    ? 'Write anything...'
                    : 'What do you do?'}
            class="text-surface-200 placeholder-surface-500 max-h-[160px] min-h-[24px] w-full resize-none border-none bg-transparent px-2 text-base leading-relaxed focus:ring-0 focus:outline-none sm:min-h-[24px]"
            rows="1"></textarea>
        </div>
        {#if ui.isGenerating}
          {#if !ui.isRetryingLastMessage}<button
              onclick={handleStopGeneration}
              class="flex h-11 w-11 shrink-0 -translate-y-0.5 animate-pulse items-center justify-center rounded-lg p-0 text-red-400 transition-all hover:text-red-300 active:scale-95 sm:translate-y-0"
              title="Stop generation"><Square class="h-6 w-6" /></button
            >
          {:else}<button
              disabled
              class="flex h-11 w-11 shrink-0 cursor-not-allowed items-center justify-center rounded-lg p-0 text-red-400 opacity-50"
              title="Stop disabled during retry"><Square class="h-6 w-6" /></button
            >{/if}
        {:else}<button
            onclick={handleSubmit}
            disabled={!inputValue.trim() || blockGeneration}
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg p-0 transition-all active:scale-95 disabled:opacity-50 {actionButtonStyles[
              actionType
            ]} -translate-y-0.5 sm:translate-y-0"
            title={blockGeneration
              ? 'AI configuration incomplete — check Settings'
              : `Send (${sendKeyHint})`}><Send class="h-6 w-6" /></button
          >{/if}
      </div>
    </div>
  {/if}
</div>
