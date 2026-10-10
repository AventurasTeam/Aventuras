/**
 * OpenAI-compatible image request, shared by OpenAI, NanoGPT and Pollinations.
 * - no references: POST {baseUrl}/images/generations (JSON)
 * - references:    POST {baseUrl}/images/edits (multipart, `image` or repeated `image[]`)
 */

import { base64ImageMime, bytesToBase64 } from '$lib/utils/image'
import type { ImageGenerateResult } from './types'
import { imageFetch, imageGetFetch } from './fetchAdapter'

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

export interface OpenAICompatibleRequest {
  baseUrl: string
  apiKey?: string
  model: string
  prompt: string
  size: string
  /** Raw base64, no `data:` prefix. */
  referenceImages?: string[]
  /** For backends whose edits endpoint takes fewer images than the scene supplies. */
  maxReferences?: number
  /** Sent as JSON values on generations and as strings on edits. */
  extraFields?: Record<string, string | number | boolean>
  signal?: AbortSignal
  serviceId: string
}

export async function generateOpenAICompatible(
  request: OpenAICompatibleRequest,
): Promise<ImageGenerateResult> {
  const { baseUrl, apiKey, model, prompt, size, maxReferences, extraFields, signal, serviceId } =
    request
  const authorization: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  const references =
    maxReferences === undefined
      ? request.referenceImages
      : request.referenceImages?.slice(0, maxReferences)

  const fields = { model, prompt, size, n: 1, response_format: 'b64_json', ...extraFields }

  const response = references?.length
    ? await imageFetch({
        url: `${baseUrl}/images/edits`,
        // No Content-Type: the FormData supplies it with its boundary.
        headers: authorization,
        body: editForm(fields, references),
        signal,
        serviceId,
      })
    : await imageFetch({
        url: `${baseUrl}/images/generations`,
        headers: { 'Content-Type': 'application/json', ...authorization },
        body: JSON.stringify(fields),
        signal,
        serviceId,
      })

  const data = await response.json()
  const imageData = data?.data?.[0]

  if (imageData?.b64_json) {
    return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
  }
  if (imageData?.url) {
    // The result URL is a CDN link, not the API: it never gets the key.
    const image = await imageGetFetch(imageData.url, undefined, { signal, serviceId })
    const base64 = bytesToBase64(new Uint8Array(await image.arrayBuffer()))
    return { base64, revisedPrompt: imageData.revised_prompt }
  }

  throw new Error(`No image data in ${serviceId} response`)
}

function editForm(
  fields: Record<string, string | number | boolean>,
  references: string[],
): FormData {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, String(value))

  const field = references.length > 1 ? 'image[]' : 'image'
  references.forEach((b64, i) => {
    const mime = base64ImageMime(b64)
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    form.append(field, new Blob([bytes], { type: mime }), `reference-${i + 1}.${EXTENSIONS[mime]}`)
  })
  return form
}
