// One request for every backend that speaks the OpenAI image API; `extraFields` join the body.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { JSONValue } from '@ai-sdk/provider'
import type { ImageGenerateResult } from './types'
import { createImageSdkFetch, generateSdkImage } from './sdkImage'

// Spread into the request body, which the SDK reads under its camelCase name.
const PROVIDER_OPTIONS_KEY = 'openaiCompatible'

export async function generateOpenAICompatibleImage(options: {
  baseUrl: string
  apiKey?: string
  serviceId: string
  model: string
  prompt: string
  size: `${number}x${number}`
  referenceImages?: string[]
  extraFields?: Record<string, JSONValue>
  signal?: AbortSignal
}): Promise<ImageGenerateResult> {
  const { baseUrl, apiKey, serviceId, model, prompt, size, referenceImages, extraFields, signal } =
    options

  const provider = createOpenAICompatible({
    name: PROVIDER_OPTIONS_KEY,
    baseURL: baseUrl,
    apiKey: apiKey || undefined,
    fetch: createImageSdkFetch(serviceId),
  })

  return generateSdkImage({
    model: provider.imageModel(model),
    prompt,
    referenceImages,
    size,
    providerOptions: { [PROVIDER_OPTIONS_KEY]: { response_format: 'b64_json', ...extraFields } },
    signal,
  })
}
