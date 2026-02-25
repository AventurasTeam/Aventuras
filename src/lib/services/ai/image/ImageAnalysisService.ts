/**
 * Image Analysis Service
 *
 * Analyzes narrative text to identify visually striking moments for image generation.
 * Uses the Vercel AI SDK with structured output for scene identification.
 *
 * This implements the "analyzed" mode where the LLM acts as an agent to select
 * which phrases/moments should have images generated.
 */

import type { VisualDescriptors } from '$lib/types'
import { ContextBuilder } from '$lib/services/context'
import { createLogger } from '../core/config'
import { generateStructured } from '../sdk/generate'
import { sceneAnalysisResultSchema, type ImageableScene } from '../sdk/schemas/imageanalysis'

const log = createLogger('ImageAnalysis')

/**
 * Context needed to analyze narrative for imageable scenes.
 */
export interface ImageAnalysisContext {
  /** The narrative text to analyze (English original) */
  narrativeResponse: string
  /** The user action that triggered this narrative */
  userAction: string
  /** Characters present in the scene with their visual descriptors */
  presentCharacters: Array<{
    name: string
    visualDescriptors?: VisualDescriptors
    isProtagonist: boolean
  }>
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
  /** Names of characters that have portrait images available */
  charactersWithPortraits: string[]
  /** Names of characters that need portrait generation before appearing in scene images */
  charactersWithoutPortraits: string[]
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
export class ImageAnalysisService {
  private presetId: string

  /**
   * Create a new ImageAnalysisService.
   * @param presetId - The preset ID to use for generation settings (default: 'imageGeneration')
   */
  constructor(presetId: string = 'imageGeneration') {
    this.presetId = presetId
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

    // Build character descriptors block
    const characterDescriptors = this.buildCharacterDescriptors(context.presentCharacters)

    // Format portrait lists
    const charactersWithPortraitsStr =
      context.charactersWithPortraits.length > 0
        ? context.charactersWithPortraits.join(', ')
        : 'None'
    const charactersWithoutPortraitsStr =
      context.charactersWithoutPortraits.length > 0
        ? context.charactersWithoutPortraits.join(', ')
        : 'None'

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
      characterDescriptors: characterDescriptors || 'No character visual descriptors available.',
      charactersWithPortraits: charactersWithPortraitsStr,
      charactersWithoutPortraits: charactersWithoutPortraitsStr,
      maxImages: context.maxImages === 0 ? '0 (unlimited)' : String(context.maxImages),
      narrativeResponse: context.narrativeResponse,
      userAction: context.userAction,
      chatHistory: context.chatHistory || '',
      lorebookContext: context.lorebookContext || '',
      translatedNarrativeBlock,
    })
    const { system, user: prompt } = await ctx.render(templateId)

    try {
      const result = await generateStructured(
        {
          presetId: this.presetId,
          schema: sceneAnalysisResultSchema,
          system,
          prompt,
        },
        templateId,
      )

      // Sort by priority (highest first)
      const sortedScenes = result.scenes.sort((a, b) => b.priority - a.priority)

      log('identifyScenes complete', {
        scenesFound: sortedScenes.length,
        priorities: sortedScenes.map((s) => s.priority),
      })

      return sortedScenes
    } catch (error) {
      log('identifyScenes failed', error)
      return []
    }
  }

  /**
   * Build a formatted string of character visual descriptors for the prompt.
   */
  private buildCharacterDescriptors(
    characters: Array<{
      name: string
      visualDescriptors?: VisualDescriptors
      isProtagonist: boolean
    }>,
  ): string {
    const withDescriptors = characters.filter((c) => c.visualDescriptors)

    if (withDescriptors.length === 0) {
      return ''
    }

    return withDescriptors
      .map((char) => {
        const vd = char.visualDescriptors!
        const parts: string[] = [`**${char.name}**:`]

        /* if (vd.gender) parts.push(`Gender: ${vd.gender}`)
        if (vd.age) parts.push(`Age: ${vd.age}`)
        if (vd.height) parts.push(`Height: ${vd.height}`)
        if (vd.build) parts.push(`Build: ${vd.build}`)
        if (vd.skinTone) parts.push(`Skin: ${vd.skinTone}`)
        if (vd.hairColor) parts.push(`Hair color: ${vd.hairColor}`)
        if (vd.hairStyle) parts.push(`Hair style: ${vd.hairStyle}`)
        if (vd.eyeColor) parts.push(`Eyes: ${vd.eyeColor}`)
        if (vd.facialFeatures) parts.push(`Face: ${vd.facialFeatures}`)
        if (vd.distinguishingMarks) parts.push(`Marks: ${vd.distinguishingMarks}`)
        if (vd.clothingStyle) parts.push(`Clothing: ${vd.clothingStyle}`)
        if (vd.accessories) parts.push(`Accessories: ${vd.accessories}`) */
        if (vd.face) parts.push(`Face: ${vd.face}`)
        if (vd.hair) parts.push(`Hair: ${vd.hair}`)
        if (vd.eyes) parts.push(`Eyes: ${vd.eyes}`)
        if (vd.build) parts.push(`Build: ${vd.build}`)
        if (vd.clothing) parts.push(`Clothing: ${vd.clothing}`)
        if (vd.accessories) parts.push(`Accessories: ${vd.accessories}`)
        if (vd.distinguishing) parts.push(`Distinguishing features: ${vd.distinguishing}`)
        if (char.isProtagonist) parts.push(` (Protagonist)`)

        return parts.join('\n  ')
      })
      .join('\n\n')
  }
}
