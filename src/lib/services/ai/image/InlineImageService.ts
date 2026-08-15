/**
 * Inline Image Generation Service
 *
 * Processes narrative content for <pic> tags and generates images inline.
 * Uses SDK-based image generation with API Profiles as the source of truth.
 *
 * When inline image mode is enabled:
 * 1. AI outputs <pic prompt="..." characters="..."></pic> tags in its narrative
 * 2. This service detects those tags and triggers image generation
 * 3. Images are stored as EmbeddedImage records with generationMode='inline'
 * 4. The rendering layer replaces <pic> tags with actual images
 */

import type { Character, EmbeddedImage } from '$lib/types'
import { runImageGeneration } from './imageUtils'
import { database } from '$lib/services/database'
import { settings } from '$lib/stores/settings.svelte'
import { emitImageQueued } from '$lib/services/events'
import { normalizeImageDataUrl, expectedPixels } from '$lib/utils/image'
import { extractPicTags, type ParsedPicTag } from '$lib/utils/inlineImageParser'
import { resolveStylePrompt } from './stylePrompt'
import { createLogger } from '$lib/log'

const log = createLogger('InlineImageGen')

export interface InlineImageContext {
  storyId: string
  entryId: string
  narrativeContent: string
  presentCharacters: Character[]
  referenceMode: boolean
}

export class InlineImageGenerationService {
  /**
   * Process narrative content for <pic> tags and generate images.
   * This is the main entry point called after narrative generation completes
   * when inline image mode is enabled.
   *
   * @returns how many tags were queued, so a caller can tell a no-op from work done.
   */
  async processNarrativeForInlineImages(context: InlineImageContext): Promise<number> {
    const imageSettings = settings.systemServicesSettings.imageGeneration

    // Extract all <pic> tags from the narrative
    const picTags = extractPicTags(context.narrativeContent)

    if (picTags.length === 0) {
      log('No <pic> tags found in narrative')
      return 0
    }

    log('Found <pic> tags', {
      count: picTags.length,
      tags: picTags.map((t) => ({
        prompt: t.prompt.slice(0, 50) + '...',
        characters: t.characters,
      })),
    })

    // Tags that already have a record are not generated again. On a fresh narration there
    // are none and this costs one empty query; on the recovery rescan it is the whole
    // point, since a second record for a tag shadows the first — the render map is keyed
    // on `sourceText` — and the working image is replaced by a fresh generation.
    const recordedTexts = await database.getEmbeddedImageSourceTextsForEntry(context.entryId)

    // The set carries the tags accepted so far as well as the recorded ones: a narration
    // can repeat a tag verbatim, and two records under one `sourceText` shadow each other
    // exactly as a duplicate of an existing record would.
    const seen = new Set(recordedTexts)
    const missingTags: ParsedPicTag[] = []
    for (const tag of picTags) {
      if (seen.has(tag.originalTag)) continue
      seen.add(tag.originalTag)
      missingTags.push(tag)
    }

    if (missingTags.length === 0) {
      log('Every <pic> tag in this entry already has a record')
      return 0
    }

    // Existing records count against the limit: it is a budget per message, not per call.
    // Counted as rows, not as distinct texts — an entry that already carries a duplicate
    // pair has spent two of the budget.
    const maxImages = imageSettings.maxImagesPerMessage ?? 3
    const remaining = maxImages === 0 ? missingTags.length : maxImages - recordedTexts.length
    const tagsToProcess = missingTags.slice(0, Math.max(0, remaining))

    if (tagsToProcess.length < missingTags.length) {
      log('Limiting to max images', {
        missing: missingTags.length,
        alreadyRecorded: recordedTexts.length,
        processing: tagsToProcess.length,
        maxAllowed: maxImages,
      })
    }

    if (tagsToProcess.length === 0) return 0

    // Process each tag
    for (const tag of tagsToProcess) {
      await this.generateImageForTag(context, tag, imageSettings)
    }

    log('All inline images queued', { count: tagsToProcess.length })
    return tagsToProcess.length
  }

  /**
   * Generate image for a single <pic> tag.
   * Selects appropriate profile and model based on portrait mode and character availability.
   */
  private async generateImageForTag(
    context: InlineImageContext,
    tag: ParsedPicTag,
    imageSettings: typeof settings.systemServicesSettings.imageGeneration,
  ): Promise<void> {
    const imageId = crypto.randomUUID()

    // Determine which profile and model to use
    let profileId = imageSettings.profileId
    let modelToUse = settings.getImageProfile(profileId ?? '')?.model ?? ''
    let sizeToUse = imageSettings.size
    let referenceImageUrls: string[] | undefined

    // If portrait mode is enabled and tag specifies characters, look for their portraits
    if (context.referenceMode && tag.characters.length > 0) {
      const portraitUrls: string[] = []
      const charactersWithPortraits: string[] = []
      const charactersWithoutPortraits: string[] = []

      for (const charName of tag.characters.slice(0, 3)) {
        const character = context.presentCharacters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase(),
        )

        const portraitUrl = normalizeImageDataUrl(character?.portrait)
        if (portraitUrl) {
          portraitUrls.push(portraitUrl)
          charactersWithPortraits.push(charName)
        } else {
          charactersWithoutPortraits.push(charName)
        }
      }

      if (portraitUrls.length > 0) {
        // Use reference profile and model for img2img
        profileId = imageSettings.referenceProfileId
        modelToUse = settings.getImageProfile(profileId ?? '')?.model ?? ''
        sizeToUse = imageSettings.referenceSize
        referenceImageUrls = portraitUrls
        log('Using character portraits as reference', {
          characters: charactersWithPortraits,
          count: portraitUrls.length,
          profileId,
          model: modelToUse,
        })
      }

      if (charactersWithoutPortraits.length > 0) {
        log('Some characters missing portraits', {
          missing: charactersWithoutPortraits,
          proceeding: 'yes - user explicitly requested via <pic> tag',
        })
      }
    }

    // Validate we have a profile
    if (!profileId) {
      log('No image profile configured, skipping')
      return
    }

    // Build full prompt with style
    const stylePrompt = await resolveStylePrompt(context.storyId, imageSettings.styleId)
    const fullPrompt = `${tag.prompt}. ${stylePrompt}`

    const { width, height } = expectedPixels(sizeToUse)

    // Create pending record in database
    const embeddedImage: Omit<EmbeddedImage, 'createdAt'> = {
      id: imageId,
      storyId: context.storyId,
      entryId: context.entryId,
      sourceText: tag.originalTag,
      prompt: fullPrompt,
      styleId: imageSettings.styleId,
      model: modelToUse,
      imageData: '',
      width,
      height,
      status: 'pending',
      generationMode: 'inline',
    }

    await database.createEmbeddedImage(embeddedImage)
    log('Created pending inline image record', {
      imageId,
      prompt: tag.prompt.slice(0, 50) + '...',
      profileId,
      model: modelToUse,
    })

    // Emit queued event
    emitImageQueued(imageId, context.entryId)

    // Start async generation (fire-and-forget)
    runImageGeneration({
      imageId,
      entryId: context.entryId,
      prompt: fullPrompt,
      profileId,
      model: modelToUse,
      size: sizeToUse,
      referenceImages: referenceImageUrls,
      notifyFailure: true,
    }).catch((error) => {
      log('Async inline image generation failed', { imageId, error })
    })
  }
}

// Export singleton instance
export const inlineImageService = new InlineImageGenerationService()
