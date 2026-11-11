/**
 * Image Generation Utilities
 *
 * Helper functions for image generation using the standalone provider registry.
 */

import { generateImage, IMAGE_PROVIDER_LABELS, warmImageCapabilities } from './providers/registry'
import { baseUrlMode, requiresApiKey } from './providers/connection'
import { database } from '#lib/services/database.ts'
import { settings } from '#lib/stores/settings.svelte.ts'
import type { EmbeddedImage, StorySettings } from '#lib/types/index.ts'
import { emitImageQueued, emitImageReady, emitImageAnalysisFailed } from '#lib/services/events.ts'
import { createLogger } from '#lib/log.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import {
  expectedPixels,
  defaultImageSpec,
  storyImageMode,
  type ImageSpec,
} from '#lib/utils/image.ts'

const log = createLogger('ImageUtils')

const IMAGE_PROFILE_SLOTS = ['standard', 'background', 'portrait', 'reference'] as const

export type ImageProfileSlot = (typeof IMAGE_PROFILE_SLOTS)[number]

const SLOT_PROFILE_KEYS = {
  standard: 'profileId',
  background: 'backgroundProfileId',
  portrait: 'portraitProfileId',
  reference: 'referenceProfileId',
} as const satisfies Record<ImageProfileSlot, string>

/**
 * Each slot answers for itself: an unset slot profile means unconfigured, never a reason to
 * spend the standard one. The settings UI and the generation paths read this same value, and
 * they have to agree — a slot the UI offers and generation then refuses fails in silence.
 */
function slotProfileId(slot: ImageProfileSlot): string | null {
  return settings.systemServicesSettings.imageGeneration?.[SLOT_PROFILE_KEYS[slot]] ?? null
}

/**
 * Check if image generation is enabled and has valid configuration.
 * Now checks Image Profiles instead of API Profiles.
 */
export function isImageGenerationEnabled(
  storySettings?: StorySettings,
  type: ImageProfileSlot = 'standard',
): boolean {
  const imageSettings = settings.systemServicesSettings.imageGeneration

  if (storySettings) {
    if (type !== 'background' && storyImageMode(storySettings) === 'none') return false
  } else {
    if (!imageSettings?.profileId) return false
  }

  const profileId = slotProfileId(type)
  if (!profileId) return false

  return !!settings.getImageProfile(profileId)
}

export type MissingCredential = 'profile' | 'apiKey' | 'baseUrl'

/** What keeps a slot from generating, or `undefined` when it is ready. */
export function missingCredential(
  slot: ImageProfileSlot = 'standard',
): MissingCredential | undefined {
  const profileId = slotProfileId(slot)
  if (!profileId) return 'profile'

  const profile = settings.getImageProfile(profileId)
  if (!profile) return 'profile'

  if (requiresApiKey(profile.providerType) && !profile.apiKey) return 'apiKey'
  if (baseUrlMode(profile.providerType) === 'required' && !normalizeBaseUrl(profile.baseUrl))
    return 'baseUrl'
  return undefined
}

export const MISSING_CREDENTIAL_REASONS: Record<MissingCredential, string> = {
  profile: 'is missing or its provider is unsupported',
  apiKey: 'has no API key configured',
  baseUrl: 'has no base URL configured',
}

/**
 * Check if required credentials are configured for a given image slot.
 */
export function hasRequiredCredentials(slot: ImageProfileSlot = 'standard'): boolean {
  return missingCredential(slot) === undefined
}

/** Loads the capabilities of every profile an image slot selects, so the first generation does not wait on them. */
export async function warmSlotCapabilities(): Promise<void> {
  const profiles = IMAGE_PROFILE_SLOTS.filter((slot) => hasRequiredCredentials(slot)).flatMap(
    (slot) => {
      const id = slotProfileId(slot)
      const profile = id ? settings.getImageProfile(id) : undefined
      return profile ? [profile] : []
    },
  )
  await warmImageCapabilities(profiles)
}

const PORTRAIT_CREDENTIAL_ERRORS: Record<MissingCredential, (providerName: string) => string> = {
  profile: () => 'No usable image profile is configured for portrait generation',
  apiKey: (providerName) => `${providerName} API key required for portrait generation`,
  baseUrl: (providerName) => `${providerName} base URL required for portrait generation`,
}

export function portraitCredentialError(providerName: string, missing: MissingCredential): string {
  return PORTRAIT_CREDENTIAL_ERRORS[missing](providerName)
}

/**
 * Get display name for the currently configured image generation provider.
 */
export function getProviderDisplayName(): string {
  const imageSettings = settings.systemServicesSettings.imageGeneration
  const profileId = imageSettings?.profileId
  if (!profileId) return 'No provider'

  const profile = settings.getImageProfile(profileId)
  if (!profile) return 'Unknown'

  return IMAGE_PROVIDER_LABELS[profile.providerType] ?? profile.providerType
}

// The live generation of each image. An aborted attempt never writes its record, so a cancelled
// or superseded request cannot land over what replaced it.
const attempts = new Map<string, AbortController>()

/** Make `controller` the image's current attempt, aborting the one it replaces. */
export function beginImageAttempt(
  imageId: string,
  controller = new AbortController(),
): AbortController {
  attempts.get(imageId)?.abort()
  attempts.set(imageId, controller)
  return controller
}

// Statements land on any pooled connection, so writes to one row must be issued in order.
const rowWrites = new Map<string, Promise<unknown>>()

/** Run `write` once the row's earlier writes have settled; a failed write does not block the next. */
function writeImageRow<T>(imageId: string, write: () => Promise<T>): Promise<T> {
  const run = (rowWrites.get(imageId) ?? Promise.resolve()).then(write)
  const tail = run
    .catch(() => {})
    .finally(() => {
      if (rowWrites.get(imageId) === tail) rowWrites.delete(imageId)
    })
  rowWrites.set(imageId, tail)
  return run
}

/** Abort the image's attempt and settle its row. A write already sent finishes first. */
export async function cancelImageGeneration(imageId: string): Promise<void> {
  attempts.get(imageId)?.abort()
  attempts.delete(imageId)
  await writeImageRow(imageId, () => database.cancelEmbeddedImage(imageId))
}

/**
 * Write a finished generation onto its record, unless the attempt was aborted.
 *
 * `ImageReady` goes out in a `finally`: it balances the `ImageQueued` the caller emitted
 * when it scheduled the work, and the header's in-flight count has to come back down even
 * when recording the outcome is itself what failed, and when it was skipped.
 */
export async function recordImageResult(
  imageId: string,
  entryId: string,
  result: { base64: string | null; error?: string },
  attempt: AbortController,
): Promise<void> {
  try {
    await writeImageRow(imageId, async () => {
      if (attempt.signal.aborted) return
      if (result.base64) {
        await database.updateEmbeddedImage(imageId, {
          imageData: result.base64,
          status: 'complete',
        })
      } else {
        await database.updateEmbeddedImage(imageId, {
          status: 'failed',
          errorMessage: result.error ?? 'Image generation failed',
        })
      }
    })
  } catch (error) {
    log('Failed to record image result', { imageId, error })
  } finally {
    if (attempts.get(imageId) === attempt) attempts.delete(imageId)
    emitImageReady(imageId, entryId, !!result.base64 && !attempt.signal.aborted)
  }
}

export interface ImageGenerationRequest {
  imageId: string
  entryId: string
  /** From `beginImageAttempt`, started when the record was created. */
  attempt: AbortController
  prompt: string
  profileId: string
  model: string
  size: ImageSpec
  referenceImages?: string[]
  /** Also raise the user-facing failure notice. Off for analyzed scenes, which report
   *  their failures through the analysis phase instead. */
  notifyFailure?: boolean
  /** Written with the flip to `generating`, so a caller resetting the row for a fresh
   *  attempt spends one round trip and not two. */
  recordUpdates?: Partial<EmbeddedImage>
  /** Emit `ImageQueued` once the row reads `generating`, for a caller resetting a finished row. */
  announce?: boolean
}

/**
 * Run one generation against an existing record and record what came back.
 *
 * Returns the base64 payload so a caller with a further use for it — saving a portrait
 * onto its character — does not have to read the row back.
 */
export async function runImageGeneration(request: ImageGenerationRequest): Promise<string | null> {
  const { imageId, entryId, prompt, profileId, model, size, referenceImages, attempt } = request

  let base64: string | null = null
  let failure: string | undefined

  // Its own try: a failed status flip is a database problem, not a generation failure, and
  // reporting it as one raises a user-facing notice for the wrong thing. The generation goes
  // ahead regardless — `recordImageResult` writes the terminal status either way. An attempt
  // cancelled or superseded before its turn in the write order leaves the row to whoever did.
  try {
    await writeImageRow(imageId, async () => {
      if (attempt.signal.aborted) return
      await database.updateEmbeddedImage(imageId, {
        ...request.recordUpdates,
        status: 'generating',
      })
    })
  } catch (error) {
    log('Failed to mark the image generating', { imageId, error })
  }
  if (request.announce) emitImageQueued(imageId, entryId)

  if (!attempt.signal.aborted) {
    try {
      log('Generating image', {
        imageId,
        profileId,
        model,
        hasReference: !!referenceImages?.length,
      })
      const result = await generateImage({
        profileId,
        model,
        prompt,
        size,
        referenceImages,
        signal: attempt.signal,
      })

      if (!result.base64) throw new Error('No image data returned')
      if (!attempt.signal.aborted) base64 = result.base64
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Unknown error'
      log('Image generation failed', { imageId, error: failure })
    }
  }

  await recordImageResult(imageId, entryId, { base64, error: failure }, attempt)

  if (failure && request.notifyFailure && !attempt.signal.aborted) {
    emitImageAnalysisFailed(entryId, failure)
  }

  return base64
}

/**
 * Retry a failed or stuck image, as a regular scene image at the current settings.
 *
 * Deliberately regular, whatever the row was generated as. An img2img reference cannot be
 * reproduced at all — the references are the portraits of the characters the analysis
 * named, and that list is not kept on the row — and a portrait is not worth reproducing:
 * a retry only rewrites the row, never `characters.portrait`, so the entry gets a picture
 * and the character keeps the one it has.
 */
export async function retryImageGeneration(imageId: string, prompt: string): Promise<void> {
  if (!isImageGenerationEnabled()) {
    log('Cannot retry - image generation not enabled')
    return
  }

  const image = await database.getEmbeddedImage(imageId)
  if (!image) {
    log('Cannot retry - image not found', { imageId })
    return
  }

  const imageSettings = settings.systemServicesSettings.imageGeneration
  const profileId = imageSettings.profileId

  if (!profileId) {
    log('Cannot retry - no profile configured')
    return
  }

  const profile = settings.getImageProfile(profileId)
  const model = profile?.model ?? ''
  const size = imageSettings.size
  const { width, height } = expectedPixels(size)

  log('Retrying image generation', { imageId, profileId, model, size })

  // `ImageReady` decrements the header's in-flight count, so the retry has to announce itself.
  // It does so after the row reads `generating`, which is what the gallery's reload looks for.
  await runImageGeneration({
    imageId,
    entryId: image.entryId,
    attempt: beginImageAttempt(imageId),
    announce: true,
    prompt,
    profileId,
    model,
    size,
    notifyFailure: true,
    recordUpdates: { prompt, model, width, height },
  })
}

/**
 * Generate a portrait image for a character.
 * Returns the base64 image data on success.
 */
export async function generatePortrait(prompt: string): Promise<string> {
  const imageSettings = settings.systemServicesSettings.imageGeneration

  const profileId = imageSettings.portraitProfileId
  if (!profileId) {
    throw new Error('No image generation profile configured')
  }

  const profile = settings.getImageProfile(profileId)
  const model = profile?.model ?? ''

  const size = imageSettings.portraitSize ?? defaultImageSpec()

  log('Generating portrait', { profileId, model, size, promptLength: prompt.length })

  const result = await generateImage({ profileId, model, prompt, size })

  if (!result.base64) {
    throw new Error('No image data returned from provider')
  }

  return result.base64
}
