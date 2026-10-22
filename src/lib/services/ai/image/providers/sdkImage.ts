// The one place an SDK image model is called: retry, abort and the result shape are shared.

import { generateImage, wrapImageModel } from 'ai'
import { IMAGE_TIMEOUT_DEFAULT } from '#lib/constants/timeout.ts'
import { createPollSdkFetch, createSdkFetch } from '#lib/services/ai/sdk/providers/sdkFetch.ts'
import { retryOn429ImageMiddleware } from '#lib/services/ai/sdk/middleware/index.ts'
import type { ImageGenerateResult } from './types'

// A 5xx may already have been billed, so only the 429 middleware retries.
const SDK_MAX_RETRIES = 0

type GenerateImageArgs = Parameters<typeof generateImage>[0]
type SdkImageModel = Parameters<typeof wrapImageModel>[0]['model']

export function createImageSdkFetch(serviceId: string) {
  return createSdkFetch({ serviceId, timeoutMs: IMAGE_TIMEOUT_DEFAULT, what: 'Image generation' })
}

/** For polling a backend: the requests share one debug entry, updated in place. */
export function createPollImageSdkFetch(serviceId: string, timeoutMs: number) {
  return createPollSdkFetch({ serviceId, timeoutMs, what: 'Image generation' })
}

export async function generateSdkImage(options: {
  model: SdkImageModel
  prompt: string
  /** Raw base64, as the registry hands adapters. */
  referenceImages?: string[]
  size?: GenerateImageArgs['size']
  aspectRatio?: GenerateImageArgs['aspectRatio']
  providerOptions?: GenerateImageArgs['providerOptions']
  signal?: AbortSignal
}): Promise<ImageGenerateResult> {
  const { model, prompt, referenceImages, size, aspectRatio, providerOptions, signal } = options

  const result = await generateImage({
    model: wrapImageModel({ model, middleware: retryOn429ImageMiddleware() }),
    prompt: referenceImages?.length ? { text: prompt, images: referenceImages } : prompt,
    size,
    aspectRatio,
    providerOptions,
    maxRetries: SDK_MAX_RETRIES,
    abortSignal: signal,
  })

  return { base64: result.image.base64 }
}
