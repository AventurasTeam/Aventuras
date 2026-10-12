/**
 * OpenAI-compatible image request, shared by OpenAI, NanoGPT and Pollinations.
 * - no references: POST {baseUrl}/images/generations (JSON)
 * - references:    POST {baseUrl}/images/edits (multipart, `image` or repeated `image[]`)
 */

import { base64ImageMime, base64ToBytes } from '#lib/utils/image.ts'
import type { ImageGenerateResult } from './types'
import { fetchImageBase64, imageFetch } from './fetchAdapter'

const EXTENSIONS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const

interface OpenAICompatibleRequest {
  baseUrl: string
  apiKey?: string
  model: string
  prompt: string
  size: string
  /** Raw base64, no `data:` prefix. */
  referenceImages?: string[]
  /** Sent as JSON values on generations and as strings on edits. */
  extraFields?: Record<string, string | number | boolean>
  signal?: AbortSignal
  serviceId: string
}

export async function generateOpenAICompatible(
  request: OpenAICompatibleRequest,
): Promise<ImageGenerateResult> {
  const { baseUrl, apiKey, model, prompt, size, referenceImages, extraFields, signal, serviceId } =
    request
  const authorization: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  const fields = { model, prompt, size, n: 1, response_format: 'b64_json', ...extraFields }
  const edit = !!referenceImages?.length

  const response = await imageFetch({
    url: `${baseUrl}/images/${edit ? 'edits' : 'generations'}`,
    // An edit sends no Content-Type: the FormData supplies it with its boundary.
    headers: edit ? authorization : { 'Content-Type': 'application/json', ...authorization },
    body: edit ? editForm(fields, referenceImages) : JSON.stringify(fields),
    signal,
    serviceId: edit ? `${serviceId}-edit` : serviceId,
  })

  const data = await response.json().catch(() => null)
  const imageData = data?.data?.[0]

  if (imageData?.b64_json) {
    return { base64: imageData.b64_json, revisedPrompt: imageData.revised_prompt }
  }
  if (imageData?.url) {
    const base64 = await fetchImageBase64(imageData.url, { signal, serviceId })
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
    form.append(
      field,
      new Blob([base64ToBytes(b64)], { type: mime }),
      `reference-${i + 1}.${EXTENSIONS[mime]}`,
    )
  })
  return form
}
