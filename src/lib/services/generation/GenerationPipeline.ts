/**
 * GenerationPipeline - Orchestrates narrative generation phases
 * Order: pre → retrieval → narrative → classification → translation → image → post
 */

import type { GenerationEvent, ErrorEvent } from './types'
import type { EmbeddedImage, ActionInputType, TranslationSettings } from '$lib/types'
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
  type ImageSettings,
} from './phases'
import {
  BackgroundImagePhase,
  type BackgroundImageDependencies,
  type BackgroundImageSettings,
} from './phases/BackgroundImagePhase'
import { mergeGenerators } from '$lib/utils/async'
import { storyContext } from '$lib/stores/storyContext.svelte'

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
  disableSuggestions: boolean
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
    cfg: PipelineConfig,
  ): AsyncGenerator<GenerationEvent, { aborted: boolean; fatalError: Error | null }> {
    const status = { aborted: false, fatalError: null as Error | null }

    try {
      yield* this.prePhase.execute({
        embeddedImages: cfg.embeddedImages,
        rawInput: cfg.rawInput,
        actionType: cfg.actionType,
        wasRawActionChoice: cfg.wasRawActionChoice,
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.retrievalPhase.execute({
        dependencies: this.deps,
        timelineFillEnabled: cfg.timelineFillEnabled,
        activationTracker: cfg.activationTracker,
        storyMode: cfg.storyMode,
        pov: cfg.pov,
        tense: cfg.tense,
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      const narrative = yield* this.narrativePhase.execute({
        styleReview: cfg.styleReview,
      })
      if (!narrative || storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* mergeGenerators({
        background: this.backgroundPhase.execute({
          imageSettings: cfg.imageSettings,
        }),
        classification: this.classificationPhase.execute(),
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.translationPhase.execute({
        isVisualProse: storyContext.preGenerationResult?.visualProseMode ?? false,
        translationSettings: cfg.translationSettings,
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.imagePhase.execute({ imageSettings: cfg.imageSettings })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.postPhase.execute({
        disableSuggestions: cfg.disableSuggestions,
        translationSettings: cfg.translationSettings,
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      return status
    } catch (error) {
      status.fatalError = error instanceof Error ? error : new Error(String(error))
      yield {
        type: 'error',
        phase: 'pre',
        error: status.fatalError,
        fatal: true,
      } satisfies ErrorEvent
      return status
    }
  }
}
