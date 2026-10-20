/**
 * Image Generation Tools
 *
 * Tool definitions for generating images within the interactive vault assistant.
 * Supports standard image generation, character portrait generation, and editing an existing
 * image through the Reference profile. Generated images are tracked by ID so they can be
 * referenced in follow-up actions.
 */

import { tool } from 'ai'
import * as z from 'zod'
import type { VaultCharacter } from '#lib/types/index.ts'
import type { VaultPendingChange } from '#lib/services/ai/sdk/schemas/vault.ts'
import {
  generateImage,
  supportsReferenceImages,
  toRawBase64,
  generatePortrait as sdkGeneratePortrait,
  isImageGenerationEnabled,
  missingCredential,
  type MissingCredential,
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

const MISSING_CREDENTIAL_REASONS: Record<MissingCredential, string> = {
  profile: 'is missing or its provider is unsupported',
  apiKey: 'has no API key configured',
  baseUrl: 'has no base URL configured',
}

function missingCredentialsError(slot: string, missing: MissingCredential): string {
  return `The ${slot} image profile ${MISSING_CREDENTIAL_REASONS[missing]}. Please tell the user to fix it in Settings → Images.`
}

const NO_IMAGE = { success: false, error: 'The image provider returned no image.' }

/** Resolve the profile and model for an image slot, or the reason it cannot be used. */
function resolveImageProfile(
  slot: 'standard' | 'reference',
): { profileId: string; model: string } | { error: string } {
  const imageSettings = settings.systemServicesSettings.imageGeneration
  if (!imageSettings.profileId) {
    return {
      error:
        'Image generation is currently disabled in user settings. Please inform the user that no image can be made.',
    }
  }

  const profileId =
    slot === 'reference' ? imageSettings.referenceProfileId : imageSettings.profileId
  if (!profileId) {
    return {
      error:
        'No Reference (Img2Img) profile is configured. Please tell the user to set one under Settings → Images → "Reference (Img2Img) Profile" to edit images.',
    }
  }

  if (!isImageGenerationEnabled(undefined, slot)) {
    return {
      error: `The configured ${slot} image profile is missing or its provider is unsupported. Please tell the user to check Settings → Images.`,
    }
  }
  const missing = missingCredential(slot)
  if (missing) return { error: missingCredentialsError(slot, missing) }

  const model = settings.getImageProfile(profileId)?.model
  if (!model) {
    return {
      error: `The ${slot} image profile has no model configured. Please tell the user to choose a model in Settings → Images.`,
    }
  }

  return { profileId, model }
}

async function resolveEditSource(
  { characters, generatedImages }: ImageToolContext,
  { imageId, characterId }: { imageId?: string; characterId?: string },
): Promise<{ source: string } | { error: string }> {
  if (imageId) {
    const dataUrl = generatedImages.get(imageId)
    if (dataUrl) return { source: dataUrl }
    return { error: unknownImageError(generatedImages, imageId) }
  }

  const character = characters().find((c) => c.id === characterId)
  if (!character) return { error: `Character with ID "${characterId}" not found` }
  if (!character.portrait) return { error: `Character "${character.name}" has no portrait.` }
  try {
    // generateImage silently drops a reference it cannot fetch; fetch here so that fails loudly.
    return { source: await toRawBase64(character.portrait) }
  } catch (error) {
    return {
      error: `Could not load the portrait of "${character.name}": ${errMessage(error)}. Please tell the user.`,
    }
  }
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
        const resolved = resolveImageProfile('standard')
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

          const missing = missingCredential('portrait')
          if (missing) {
            return {
              success: false,
              characterName: character.name,
              error: missingCredentialsError('portrait', missing),
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

    edit_image: tool({
      description:
        "Edit an existing image with the Reference (Img2Img) profile, keeping its likeness. Give `instruction` and exactly one source: `imageId` (an image generated this session) or `characterId` (that character's current portrait, including a pending or unsaved one). The edit is a new image; the source is never overwritten. A success result means the user can see the image; on failure, tell the user and do not retry. Use set_portrait with the new imageId to assign it.",
      inputSchema: z.object({
        instruction: z.string().describe('The change to make to the image'),
        imageId: z.string().optional().describe('ID of an image generated this session'),
        characterId: z
          .string()
          .optional()
          .describe('ID of the character whose current portrait to edit'),
      }),
      execute: async ({ instruction, imageId, characterId }) => {
        if (!imageId === !characterId) {
          return { success: false, error: 'Provide exactly one of imageId or characterId.' }
        }

        const resolved = resolveImageProfile('reference')
        if ('error' in resolved) return { success: false, error: resolved.error }

        if (!(await supportsReferenceImages(resolved.profileId, resolved.model))) {
          return {
            success: false,
            error: `The Reference profile's provider or model "${resolved.model}" cannot take a reference image. Please tell the user to pick an img2img-capable model in Settings → Images.`,
          }
        }

        const edit = await resolveEditSource(context, { imageId, characterId })
        if ('error' in edit) return { success: false, error: edit.error }

        try {
          const result = await generateImage({
            profileId: resolved.profileId,
            model: resolved.model,
            prompt: instruction,
            size: settings.systemServicesSettings.imageGeneration.referenceSize,
            referenceImages: [edit.source],
          })

          if (!result.base64) return NO_IMAGE

          const newImageId = registerImage(result.base64)
          return {
            success: true,
            imageId: newImageId,
            message: `Edited image created (imageId: ${newImageId}). The image is displayed in the chat and the original is unchanged. Use imageId with set_portrait to assign it as a character portrait.`,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to edit the image: ${errMessage(error)}. Please tell the user.`,
          }
        }
      },
    }),

    /**
     * Set a previously generated image as a character's portrait.
     */
    set_portrait: tool({
      description:
        "Set a previously generated image as a character's portrait. Requires an imageId from a prior generate_standard_image, generate_portrait or edit_image call. The change will be pending until approved.",
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
