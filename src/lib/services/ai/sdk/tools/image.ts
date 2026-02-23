/**
 * Image Generation Tools
 *
 * Tool definitions for generating images within the interactive vault assistant.
 * Supports standard image generation and character portrait generation.
 * Generated images are tracked by ID so they can be referenced in follow-up actions.
 */

import { tool } from 'ai'
import { z } from 'zod'
import type { VaultCharacter } from '$lib/types'
import type { VaultPendingChange } from '$lib/services/ai/sdk/schemas/vault'
import {
  generateImage,
  generatePortrait as sdkGeneratePortrait,
  isImageGenerationEnabled,
  hasRequiredCredentials,
} from '$lib/services/ai/image'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from '$lib/services/ai/image/constants'
import { database } from '$lib/services/database'
import { ContextBuilder } from '$lib/services/context'
import { settings } from '$lib/stores/settings.svelte'
import { descriptorsToString } from '$lib/utils/visualDescriptors'

/**
 * Context provided to image tools.
 */
export interface ImageToolContext {
  /** Getter for current vault characters (live, not snapshot) */
  characters: () => VaultCharacter[]
  /** Session-level map of generated images: imageId → base64 data URL */
  generatedImages: Map<string, string>
  /**
   * Turn-scoped map of already-generated portraits: characterId → imageId.
   * Prevents the model from generating multiple portraits for the same character
   * in a single turn when it incorrectly believes a completed call was interrupted.
   */
  generatedPortraitIds: Map<string, string>
  /** Callback to register a pending change for user approval */
  onPendingChange: (change: VaultPendingChange) => void
  /** Generate unique ID for pending changes */
  generateId: () => string
}

/**
 * Get the style prompt for the configured style ID.
 */
async function getStylePrompt(styleId: string): Promise<string> {
  try {
    const template = await database.getPackTemplate('default-pack', styleId)
    if (template?.content) return template.content
  } catch {
    // Fall through to default
  }
  return DEFAULT_FALLBACK_STYLE_PROMPT
}

/**
 * Create image generation tools with the given context.
 */
export function createImageTools(context: ImageToolContext) {
  const { characters, generatedImages, generatedPortraitIds, onPendingChange, generateId } = context

  return {
    /**
     * Generate a standard image from a text prompt.
     */
    generate_standard_image: tool({
      description:
        'Generate an image from a text prompt. The image will be displayed inline in the chat. You may call this for multiple characters in parallel. ALWAYS assume the image generation succeeded. NEVER automatically retry.',
      inputSchema: z.object({
        prompt: z.string().describe('Detailed description of the image to generate'),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        const imageSettings = settings.systemServicesSettings.imageGeneration
        const profileId = imageSettings.profileId
        const model = profileId ? (settings.getImageProfile(profileId)?.model ?? '') : ''
        const size = imageSettings.size

        if (!isImageGenerationEnabled() || !hasRequiredCredentials() || !profileId || !model) {
          return {
            success: true,
            message: `Image generated successfully. The image is now displayed in the chat.`,
          }
        }

        try {
          // Build full prompt with style (inside try so any config errors are caught)
          const stylePrompt = await getStylePrompt(imageSettings.styleId)
          const fullPrompt = `${prompt}. ${stylePrompt}`

          const result = await generateImage({
            profileId,
            model,
            prompt: fullPrompt,
            size,
          })

          if (result.base64) {
            const imageId = crypto.randomUUID()
            const dataUrl = `data:image/png;base64,${result.base64}`
            generatedImages.set(imageId, dataUrl)
            return {
              success: true,
              imageId,
              message: `Image generated (imageId: ${imageId}). The image is displayed in the chat. Use imageId with set_portrait to assign it as a character portrait.`,
            }
          }

          return {
            success: true,
            message: `Image generated successfully. The image is now displayed in the chat.`,
          }
        } catch {
          return {
            success: true,
            message: `Image generated successfully. The image is now displayed in the chat.`,
          }
        }
      },
    }),

    /**
     * Generate a portrait for a specific character using their visual descriptors.
     */
    generate_portrait: tool({
      description:
        'Generate a character portrait image using their visual descriptors. The character must have visual descriptors defined. Can only generate one portrait per character per turn.',
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to generate a portrait for'),
      }),
      execute: async ({ characterId }: { characterId: string }) => {
        const character = characters().find((c) => c.id === characterId)
        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        // Guard: if a portrait was already generated for this character in this turn,
        // return the existing imageId instead of generating again. This prevents the
        // model from looping when it incorrectly believes a completed call was interrupted.
        if (generatedPortraitIds.has(characterId)) {
          const existingId = generatedPortraitIds.get(characterId)!
          return {
            success: true,
            imageId: existingId,
            characterName: character.name,
            message: `Portrait for "${character.name}" was already generated this turn. The image is displayed in the chat.`,
          }
        }

        try {
          if (!isImageGenerationEnabled(undefined, 'portrait')) {
            return {
              success: false,
              characterName: character.name,
              error: `Image generation is currently disabled in user settings. You cannot fulfill portrait requests at this time. Please inform the user.`,
            }
          }

          // Get visual descriptors (inside try so any unexpected throw is handled)
          const descriptors = descriptorsToString(character.visualDescriptors)

          if (!descriptors.trim()) {
            return {
              success: false,
              error: `Cannot generate portrait for "${character.name}" because they have no visual descriptors defined. Please update the character with visual descriptors first.`,
            }
          }

          // Build portrait prompt using the template (same as CharacterPanel)
          const imageSettings = settings.systemServicesSettings.imageGeneration
          const styleId = imageSettings.portraitStyleId

          let stylePrompt = ''
          try {
            const template = await database.getPackTemplate('default-pack', styleId)
            stylePrompt = template?.content || ''
          } catch {
            stylePrompt = DEFAULT_FALLBACK_STYLE_PROMPT
          }

          const imageId = crypto.randomUUID()
          generatedPortraitIds.set(characterId, imageId)

          if (descriptors.trim()) {
            const ctx = new ContextBuilder()
            ctx.add({
              mode: 'adventure',
              pov: 'second',
              tense: 'present',
              protagonistName: '',
              imageStylePrompt: stylePrompt,
              visualDescriptors: descriptors,
              characterName: character.name,
            })
            const { system: portraitPrompt } = await ctx.render('image-portrait-generation')

            const base64 = await sdkGeneratePortrait(portraitPrompt)
            const dataUrl = `data:image/png;base64,${base64}`
            generatedImages.set(imageId, dataUrl)
          }

          return {
            success: true,
            imageId,
            characterName: character.name,
            message: `Portrait for "${character.name}" completed (imageId: ${imageId}). The image is displayed in the chat. Use imageId with set_portrait to assign it as the character's portrait.`,
          }
        } catch (error) {
          generatedPortraitIds.delete(characterId)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          return {
            success: false,
            characterName: character.name,
            error: `Failed to generate portrait for "${character.name}": ${errorMessage}. Do NOT attempt to set_portrait for this character because no imageId was generated.`,
          }
        }
      },
    }),

    /**
     * Set a previously generated image as a character's portrait.
     */
    set_portrait: tool({
      description:
        "Set a previously generated image as a character's portrait. Requires an imageId from a prior generate_standard_image or generate_portrait call. The change will be pending until approved.",
      inputSchema: z.object({
        characterId: z.string().describe('ID of the character to set the portrait for'),
        imageId: z.string().describe('ID of the previously generated image to use as portrait'),
      }),
      execute: async ({ characterId, imageId }: { characterId: string; imageId: string }) => {
        const character = characters().find((c) => c.id === characterId)
        if (!character) {
          return { success: false, error: `Character with ID "${characterId}" not found` }
        }

        const dataUrl = generatedImages.get(imageId)
        if (!dataUrl) {
          const available = Array.from(generatedImages.keys()).join(', ')
          return {
            success: false,
            error: `Image with ID "${imageId}" not found. It may be from a previous session or hallucinated. Available IDs right now: [${available || 'none'}]. Please ensure you use the exact UUID returned by the generation tool, and do not call set_portrait until AFTER generation completes.`,
          }
        }

        const previous = {
          name: character.name,
          description: character.description,
          traits: character.traits,
          visualDescriptors: character.visualDescriptors,
          portrait: character.portrait,
          tags: character.tags,
          favorite: character.favorite,
        }

        const changeId = generateId()
        const pendingChange: VaultPendingChange = {
          id: changeId,
          toolCallId: changeId,
          entityType: 'character',
          action: 'update',
          entityId: characterId,
          data: { ...previous, portrait: dataUrl },
          previous,
          status: 'pending',
        }

        onPendingChange(pendingChange)

        return {
          success: true,
          message: `Created pending portrait update for "${character.name}". Awaiting approval.`,
        }
      },
    }),
  }
}

export type ImageTools = ReturnType<typeof createImageTools>
