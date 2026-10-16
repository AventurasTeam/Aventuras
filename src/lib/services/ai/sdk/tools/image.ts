/**
 * Image Generation Tools
 *
 * Tool definitions for generating images within the interactive vault assistant.
 * Supports standard image generation and character portrait generation.
 * Generated images are tracked by ID so they can be referenced in follow-up actions.
 */

import { tool } from 'ai'
import * as z from 'zod'
import type { VaultCharacter } from '#lib/types/index.ts'
import type { VaultPendingChange } from '#lib/services/ai/sdk/schemas/vault.ts'
import {
  generateImage,
  generatePortrait as sdkGeneratePortrait,
  isImageGenerationEnabled,
  hasRequiredCredentials,
} from '#lib/services/ai/image/index.ts'
import { DEFAULT_FALLBACK_STYLE_PROMPT } from '#lib/services/ai/image/constants.ts'
import { database } from '#lib/services/database.ts'
import { ContextBuilder } from '#lib/services/context/index.ts'
import { settings } from '#lib/stores/settings.svelte.ts'
import { errMessage } from '#lib/utils/error.ts'
import { descriptorsToString } from '#lib/utils/visualDescriptors.ts'

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

function unknownImageError(generatedImages: Map<string, string>, imageId: string): string {
  const available = [...generatedImages.keys()].join(', ')
  return `Image with ID "${imageId}" not found. It may be from a previous session or hallucinated. Available IDs right now: [${available || 'none'}].`
}

function missingCredentialsError(slot: string): string {
  return `The ${slot} image profile has no API key configured. Please tell the user to add credentials in Settings → Images.`
}

const NO_IMAGE = { success: false, error: 'The image provider returned no image.' }

/** Resolve the profile and model for standard generation, or the reason it cannot be used. */
function resolveImageProfile(): { profileId: string; model: string } | { error: string } {
  const profileId = settings.systemServicesSettings.imageGeneration.profileId
  if (!profileId) {
    return {
      error:
        'Image generation is currently disabled in user settings. Please inform the user that no image can be made.',
    }
  }

  if (!isImageGenerationEnabled()) {
    return {
      error:
        'The configured image profile is missing or its provider is unsupported. Please tell the user to check Settings → Images.',
    }
  }
  if (!hasRequiredCredentials()) {
    return { error: missingCredentialsError('standard') }
  }

  const model = settings.getImageProfile(profileId)?.model
  if (!model) {
    return {
      error:
        'The image profile has no model configured. Please tell the user to choose a model in Settings → Images.',
    }
  }

  return { profileId, model }
}

/**
 * Create image generation tools with the given context.
 */
export function createImageTools(context: ImageToolContext) {
  const { characters, generatedImages, generatedPortraitIds, onPendingChange, generateId } = context

  const registerImage = (base64: string, imageId = crypto.randomUUID()): string => {
    generatedImages.set(imageId, `data:image/png;base64,${base64}`)
    return imageId
  }

  return {
    /**
     * Generate a standard image from a text prompt.
     */
    generate_standard_image: tool({
      description:
        'Generate an image from a text prompt. The image will be displayed inline in the chat. You may call this for multiple characters in parallel. A success result means the user can see the image. NEVER automatically retry; if it fails, tell the user.',
      inputSchema: z.object({
        prompt: z.string().describe('Detailed description of the image to generate'),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        const resolved = resolveImageProfile()
        if ('error' in resolved) return { success: false, error: resolved.error }

        try {
          const imageSettings = settings.systemServicesSettings.imageGeneration
          const stylePrompt = await getStylePrompt(imageSettings.styleId)

          const result = await generateImage({
            profileId: resolved.profileId,
            model: resolved.model,
            prompt: `${prompt}. ${stylePrompt}`,
            size: imageSettings.size,
          })

          if (!result.base64) return NO_IMAGE

          const imageId = registerImage(result.base64)
          return {
            success: true,
            imageId,
            message: `Image generated (imageId: ${imageId}). The image is displayed in the chat. Use imageId with set_portrait to assign it as a character portrait.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to generate the image: ${errMessage(error)}. Please tell the user.`,
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
        const existingId = generatedPortraitIds.get(characterId)
        if (existingId) {
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

          if (!hasRequiredCredentials('portrait')) {
            return {
              success: false,
              characterName: character.name,
              error: missingCredentialsError('portrait'),
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

          registerImage(await sdkGeneratePortrait(portraitPrompt), imageId)

          return {
            success: true,
            imageId,
            characterName: character.name,
            message: `Portrait for "${character.name}" completed (imageId: ${imageId}). The image is displayed in the chat. Use imageId with set_portrait to assign it as the character's portrait.`,
          }
        } catch (error) {
          generatedPortraitIds.delete(characterId)
          return {
            success: false,
            characterName: character.name,
            error: `Failed to generate portrait for "${character.name}": ${errMessage(error)}. Do NOT attempt to set_portrait for this character because no imageId was generated.`,
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
          return {
            success: false,
            error: `${unknownImageError(generatedImages, imageId)} Please ensure you use the exact UUID returned by the generation tool, and do not call set_portrait until AFTER generation completes.`,
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
          changeId,
          message: `Created pending portrait update for "${character.name}". Awaiting approval.`,
        }
      },
    }),
  }
}

export type ImageTools = ReturnType<typeof createImageTools>
