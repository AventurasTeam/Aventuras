/**
 * GenerationPipeline - Orchestrates narrative generation phases
 * Order: pre → retrieval → narrative → [(classification ‖ translation → image) ‖ background ‖ post]
 */

import { createLogger } from '$lib/log'

const log = createLogger('GenerationPipeline')

import type { GenerationEvent, GenerationContext, ErrorEvent } from './types'
import {
  RetrievalPhase,
  NarrativePhase,
  ClassificationPhase,
  TranslationPhase,
  ImagePhase,
  PostGenerationPhase,
} from './phases'
import { BackgroundImagePhase } from './phases/BackgroundImagePhase'
import { mergeGenerators } from '$lib/utils/async'
import { story } from '$lib/stores/story/index.svelte'

export class GenerationPipeline {
  private retrievalPhase = new RetrievalPhase()
  private narrativePhase = new NarrativePhase()
  private backgroundPhase = new BackgroundImagePhase()
  private classificationPhase = new ClassificationPhase()
  private translationPhase = new TranslationPhase()
  private imagePhase = new ImagePhase()
  private postPhase = new PostGenerationPhase()

  async *execute(): AsyncGenerator<
    GenerationEvent,
    { aborted: boolean; fatalError: Error | null }
  > {
    const status = { aborted: false, fatalError: null as Error | null }

    try {
      yield* this.retrievalPhase.execute()
      if (story.generationContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.narrativePhase.execute()
      if (!story.generationContext.narrativeResult || story.generationContext.abortSignal?.aborted)
        return { ...status, aborted: true }

      yield* mergeGenerators({
        background: this.backgroundPhase.execute(),
        classification: this.classificationPhase.execute(),
      if (story.generationContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.translationPhase.execute()
      if (story.generationContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.imagePhase.execute()
      if (story.generationContext.abortSignal?.aborted) return { ...status, aborted: true }

      yield* this.postPhase.execute()
      if (story.generationContext.abortSignal?.aborted) return { ...status, aborted: true }

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
