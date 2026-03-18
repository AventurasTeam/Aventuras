/**
 * GenerationPipeline - Orchestrates narrative generation phases
 * Order: pre → retrieval → narrative → classification → translation → image → post
 */

import type { GenerationEvent, ErrorEvent } from './types'
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
} from './phases'
import {
  BackgroundImagePhase,
  type BackgroundImageDependencies,
} from './phases/BackgroundImagePhase'
import { mergeGenerators } from '$lib/utils/async'
import { storyContext } from '$lib/stores/storyContext.svelte'
import { aiService } from '$lib/services/ai'

export interface PipelineDependencies
  extends
    RetrievalDependencies,
    NarrativeDependencies,
    BackgroundImageDependencies,
    ClassificationDependencies,
    TranslationDependencies,
    ImageDependencies,
    PostGenerationDependencies {}

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

  static create(): GenerationPipeline {
    const deps: PipelineDependencies = {
      shouldUseAgenticRetrieval: (chaptersLength: number) =>
        aiService.shouldUseAgenticRetrieval(new Array(chaptersLength)),
      runAgenticRetrieval: aiService.runAgenticRetrieval.bind(aiService),
      runTimelineFill: aiService.runTimelineFill.bind(aiService),
      answerChapterQuestion: aiService.answerChapterQuestion.bind(aiService),
      answerChapterRangeQuestion: aiService.answerChapterRangeQuestion.bind(aiService),
      getRelevantLorebookEntries: aiService.getRelevantLorebookEntries.bind(aiService),
      streamNarrative: aiService.streamNarrative.bind(aiService),
      classifyResponse: aiService.classifyResponse.bind(aiService),
      translateNarration: aiService.translateNarration.bind(aiService),
      generateImagesForNarrative: aiService.generateImagesForNarrative.bind(aiService),
      isImageGenerationEnabled: (storySettings, type) =>
        aiService.isImageGenerationEnabled(storySettings, type),
      generateSuggestions: aiService.generateSuggestions.bind(aiService),
      translateSuggestions: aiService.translateSuggestions.bind(aiService),
      generateActionChoices: aiService.generateActionChoices.bind(aiService),
      translateActionChoices: aiService.translateActionChoices.bind(aiService),
      analyzeBackgroundChangeAndGenerateImage:
        aiService.analyzeBackgroundChangeAndGenerateImage.bind(aiService),
    }
    return new GenerationPipeline(deps)
  }

  async *execute(): AsyncGenerator<
    GenerationEvent,
    { aborted: boolean; fatalError: Error | null }
  > {
    const status = { aborted: false, fatalError: null as Error | null }

    try {
      yield* this.prePhase.execute()
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.retrievalPhase.execute({ dependencies: this.deps })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      const narrative = yield* this.narrativePhase.execute()
      if (!narrative || storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* mergeGenerators({
        background: this.backgroundPhase.execute(),
        classification: this.classificationPhase.execute(),
      })
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.translationPhase.execute()
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.imagePhase.execute()
      if (storyContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.postPhase.execute()
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
