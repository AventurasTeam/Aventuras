/**
 * Image Analysis Service
 *
 * Analyzes narrative text to identify visually striking moments for image generation.
 * Uses the Vercel AI SDK with structured output for scene identification.
 *
 * This implements the "analyzed" mode where the LLM acts as an agent to select
 * which phrases/moments should have images generated.
 */

import type { Character } from '$lib/types'
import { BaseAIService } from '../BaseAIService'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '$lib/log'
import { sceneAnalysisResultSchema, type ImageableScene } from '../sdk/schemas/imageanalysis'
import { mapPresentCharacters } from '$lib/services/context/imageMapper'

const log = createLogger('ImageAnalysis')

/**
 * Context needed to analyze narrative for imageable scenes.
 */
export interface ImageAnalysisContext {
  /** The narrative text to analyze (English original) */
  narrativeResponse: string
  /** The user action that triggered this narrative */
  userAction: string
  /** Characters present in the scene */
  presentCharacters: Character[]
  /** Current location name */
  currentLocation?: string
  /** The image style prompt to include */
  stylePrompt: string
  /** Maximum number of images (0 = unlimited) */
  maxImages: number
  /** Full chat history for comprehensive context */
  chatHistory?: string
  /** Activated lorebook entries for world context */
  lorebookContext?: string
  /** Translated narrative text - use this for sourceText extraction when available */
  translatedNarrative?: string
  /** Target language for translation */
  translationLanguage?: string
  /** Generate images with character references */
  referenceMode: boolean
}

/**
 * Service that identifies imageable scenes in narrative text using the Vercel AI SDK.
 */
export class ImageAnalysisService extends BaseAIService {
  /**
   * Create a new ImageAnalysisService.
   * @param serviceId - The service ID used to resolve the preset dynamically
   */
  constructor(serviceId: string) {
    super(serviceId)
  }

  /**
   * Analyze narrative text to identify visually striking moments.
   * Returns an array of imageable scenes sorted by priority (highest first).
   */
  async identifyScenes(context: ImageAnalysisContext): Promise<ImageableScene[]> {
    log('identifyScenes called', {
      narrativeLength: context.narrativeResponse.length,
      presentCharactersCount: context.presentCharacters.length,
      referenceMode: context.referenceMode,
      maxImages: context.maxImages,
      hasTranslation: !!context.translatedNarrative,
    })

    // Build translated narrative block if available
    let translatedNarrativeBlock = ''
    if (context.translatedNarrative && context.translationLanguage) {
      translatedNarrativeBlock = `## Display Narrative (${context.translationLanguage} - use this for sourceText)
${context.translatedNarrative}`
    }

    // Select template based on portrait mode
    const templateId = context.referenceMode
      ? 'image-prompt-analysis-reference'
      : 'image-prompt-analysis'

    // Build context and render
    const ctx = new ContextBuilder()
    ctx.add({
      imageStylePrompt: context.stylePrompt,
      sceneCharacters: mapPresentCharacters(context.presentCharacters),
      maxImages: context.maxImages === 0 ? '0 (unlimited)' : String(context.maxImages),
      narrativeResponse: context.narrativeResponse,
      userAction: context.userAction,
      chatHistory: context.chatHistory || '',
      lorebookContext: context.lorebookContext || '',
      translatedNarrativeBlock,
    })
    const { system, user: prompt } = await ctx.render(templateId)

    try {
      const result = await this.generate(sceneAnalysisResultSchema, system, prompt, templateId)

      // Sort by priority (highest first)
      const sortedScenes = result.scenes.sort((a, b) => b.priority - a.priority)

      log('identifyScenes complete', {
        scenesFound: sortedScenes.length,
        priorities: sortedScenes.map((s) => s.priority),
      })

      return sortedScenes as ImageableScene[]
    } catch (error) {
      log('identifyScenes failed', error)
      return []
    }
  }
}
