/**
 * GenerationPipeline - Orchestrates narrative generation phases
 * Order: pre → retrieval → narrative → classification → translation → image → post
 */

import type { GenerationEvent, GenerationContext, ErrorEvent } from './types'
import type {
  EmbeddedImage,
  ActionInputType,
  TranslationSettings,
  Character,
  StoryBeat,
} from '$lib/types'
import type { StoryMode, POV, Tense } from '$lib/types'
import type { StyleReviewResult } from '$lib/services/ai/generation/StyleReviewerService'
import type { ActivationTracker } from '$lib/services/ai/retrieval/EntryRetrievalService'
import {
  PreGenerationPhase,
  RetrievalPhase,
  NarrativePhase,
  ClassificationPhase,
  TranslationPhase,
  ImagePhase,
  PostGenerationPhase,
  type RetrievalDependencies,
  type NarrativeDependencies,
  type ClassificationDependencies,
  type TranslationDependencies,
  type ImageDependencies,
  type PostGenerationDependencies,
  type PreGenerationResult,
  type NarrativeResult,
  type ClassificationPhaseResult,
  type TranslationResult2,
  type ImageResult,
  type PostGenerationResult,
  type PromptContext,
  type ImageSettings,
} from './phases'
import {
  BackgroundImagePhase,
  type BackgroundImageDependencies,
  type BackgroundImageResult,
  type BackgroundImageSettings,
} from './phases/BackgroundImagePhase'
import { mergeGenerators } from '$lib/utils/async'

export interface PipelineDependencies
  extends
    RetrievalDependencies,
    NarrativeDependencies,
    BackgroundImageDependencies,
    ClassificationDependencies,
    TranslationDependencies,
    ImageDependencies,
    PostGenerationDependencies {}

export interface PipelineConfig {
  embeddedImages: EmbeddedImage[]
  rawInput: string
  actionType: ActionInputType
  wasRawActionChoice: boolean
  timelineFillEnabled: boolean
  storyMode: StoryMode
  pov: POV
  tense: Tense
  styleReview: StyleReviewResult | null
  activationTracker?: ActivationTracker
  translationSettings: TranslationSettings
  imageSettings: ImageSettings & BackgroundImageSettings
  promptContext: PromptContext
  disableSuggestions: boolean
  activeThreads: StoryBeat[]
}

export interface PipelineResult {
  preGeneration: PreGenerationResult | null
  narrative: NarrativeResult | null
  background: BackgroundImageResult | null
  classification: ClassificationPhaseResult | null
  translation: TranslationResult2 | null
  image: ImageResult | null
  postGeneration: PostGenerationResult | null
  aborted: boolean
  fatalError: Error | null
}

export class GenerationPipeline {
  private prePhase = new PreGenerationPhase()
  private retrievalPhase = new RetrievalPhase()
  private narrativePhase: NarrativePhase
  private backgroundPhase: BackgroundImagePhase
  private classificationPhase: ClassificationPhase
  private translationPhase: TranslationPhase
  private imagePhase: ImagePhase
  private postPhase: PostGenerationPhase

  constructor(private deps: PipelineDependencies) {
    this.narrativePhase = new NarrativePhase(deps)
    this.backgroundPhase = new BackgroundImagePhase(deps)
    this.classificationPhase = new ClassificationPhase(deps)
    this.translationPhase = new TranslationPhase(deps)
    this.imagePhase = new ImagePhase(deps)
    this.postPhase = new PostGenerationPhase(deps)
  }

  async *execute(
    ctx: GenerationContext,
    cfg: PipelineConfig,
  ): AsyncGenerator<GenerationEvent, PipelineResult> {
    const r: PipelineResult = {
      preGeneration: null,
      narrative: null,
      background: null,
      classification: null,
      translation: null,
      image: null,
      postGeneration: null,
      aborted: false,
      fatalError: null,
    }

    try {
      r.preGeneration = yield* this.prePhase.execute({
        context: ctx,
        embeddedImages: cfg.embeddedImages,
        rawInput: cfg.rawInput,
        actionType: cfg.actionType,
        wasRawActionChoice: cfg.wasRawActionChoice,
      })
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      const retrieval = yield* this.retrievalPhase.execute({
        context: ctx,
        dependencies: this.deps,
        timelineFillEnabled: cfg.timelineFillEnabled,
        activationTracker: cfg.activationTracker,
        storyMode: cfg.storyMode,
        pov: cfg.pov,
        tense: cfg.tense,
      })
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      r.narrative = yield* this.narrativePhase.execute({
        visibleEntries: ctx.visibleEntries,
        worldState: ctx.worldState,
        story: ctx.story,
        retrievalResult: retrieval,
        styleReview: cfg.styleReview,
        abortSignal: ctx.abortSignal,
      })
      if (!r.narrative || ctx.abortSignal?.aborted) return { ...r, aborted: true }

      const parallelPhases = yield* mergeGenerators({
        background: this.backgroundPhase.execute({
          storyId: ctx.story.id,
          storyEntries: ctx.visibleEntries,
          imageSettings: cfg.imageSettings,
          abortSignal: ctx.abortSignal,
        }),
        classification: this.classificationPhase.execute({
          narrativeContent: r.narrative.content,
          narrativeEntryId: ctx.userAction.entryId,
          userActionContent: ctx.userAction.content,
          worldState: ctx.worldState,
          story: ctx.story,
          visibleEntries: ctx.visibleEntries,
          abortSignal: ctx.abortSignal,
        }),
      })

      r.background = parallelPhases.background
      r.classification = parallelPhases.classification
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      r.translation = yield* this.translationPhase.execute({
        narrativeContent: r.narrative.content,
        narrativeEntryId: ctx.userAction.entryId,
        isVisualProse: r.preGeneration?.visualProseMode ?? false,
        translationSettings: cfg.translationSettings,
        abortSignal: ctx.abortSignal,
      })
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      r.image = yield* this.imagePhase.execute(this.buildImageInput(ctx, cfg, r))
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      r.postGeneration = yield* this.postPhase.execute({
        isCreativeMode: cfg.storyMode === 'creative-writing',
        disableSuggestions: cfg.disableSuggestions,
        entries: ctx.visibleEntries,
        activeThreads: cfg.activeThreads,
        lorebookEntries: ctx.worldState.lorebookEntries,
        promptContext: cfg.promptContext,
        worldState: ctx.worldState,
        narrativeResponse: r.narrative.content,
        pov: cfg.pov,
        translationSettings: cfg.translationSettings,
        abortSignal: ctx.abortSignal,
      })
      if (ctx.abortSignal?.aborted) return { ...r, aborted: true }

      return r
    } catch (error) {
      r.fatalError = error instanceof Error ? error : new Error(String(error))
      yield { type: 'error', phase: 'pre', error: r.fatalError, fatal: true } satisfies ErrorEvent
      return r
    }
  }

  private buildImageInput(ctx: GenerationContext, cfg: PipelineConfig, r: PipelineResult) {
    const names = r.classification?.classificationResult?.scene?.presentCharacterNames ?? []
    const presentCharacters: Character[] = ctx.worldState.characters.filter((c) =>
      names.includes(c.name),
    )
    return {
      storyId: ctx.story.id,
      entryId: ctx.narrationEntryId || ctx.userAction.entryId,
      narrativeContent: r.narrative?.content ?? '',
      userAction: ctx.userAction.content,
      presentCharacters,
      currentLocation: ctx.worldState.currentLocation?.name,
      translatedNarrative: r.translation?.translatedContent ?? undefined,
      translationLanguage: r.translation?.targetLanguage ?? undefined,
      imageSettings: cfg.imageSettings,
      abortSignal: ctx.abortSignal,
    }
  }
}
