// NanoGPT's unified image API (POST {base}/images) as an AI SDK image model. It is a custom model
// because the unified `/images` endpoint and its `input_references` are not the OpenAI image shape.

import * as z from 'zod'
import { InvalidResponseDataError } from 'ai'
import type { ImageModelV4, SharedV4Warning } from '@ai-sdk/provider'
import { bytesToBase64 } from '#lib/utils/image.ts'
import { isPublicHttpUrl } from '#lib/utils/url.ts'
import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import {
  definedHeaders,
  fileBase64,
  httpError,
  inlineFile,
  parseJson,
  responseExcerpt,
} from './imageModelUtils'

interface NanoGPTImageSettings {
  apiKey: string
  baseURL: string
  fetch: Fetch
}

// `url` is the documented alternative to `b64_json`; every model seen so far answers `b64_json`.
const GenerationResponse = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().optional().catch(undefined),
        url: z.string().optional().catch(undefined),
      }),
    )
    .catch([]),
})

// Two shapes: `{ error: { message } }` and `{ error: '<message>' }`.
const ErrorBody = z.object({
  error: z.union([z.string(), z.object({ message: z.string() })]).optional(),
  message: z.string().optional(),
})

function errorMessage(parsed: unknown, text: string, status: number): string {
  const body = ErrorBody.safeParse(parsed)
  if (body.success) {
    const { error, message } = body.data
    const found = typeof error === 'string' ? error : (error?.message ?? message)
    if (found) return found
  }
  return responseExcerpt(text, status)
}

// A plain Error, not an APICallError: a 429 from the host would otherwise make the 429 middleware
// re-run, and re-bill, the generation. The URL comes from the reply, so it must be public and is
// not redirected.
async function downloadBase64(fetch: Fetch, url: string, signal?: AbortSignal): Promise<string> {
  if (!isPublicHttpUrl(url)) throw new Error('Image URL does not point at a public host')
  const response = await fetch(url, { signal, redirect: 'manual' })
  if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`)
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()))
}

export function createNanoGPTImage(settings: NanoGPTImageSettings) {
  const url = `${settings.baseURL.replace(/\/+$/, '')}/images`

  return {
    imageModel(modelId: string): ImageModelV4 {
      return {
        specificationVersion: 'v4',
        provider: 'nanogpt.image',
        modelId,
        maxImagesPerCall: 1,
        supportsFileInputs: true,
        supportsMaskInputs: false,

        async doGenerate({
          prompt,
          n,
          size,
          aspectRatio,
          files,
          mask,
          providerOptions,
          abortSignal,
          headers,
        }) {
          const warnings: SharedV4Warning[] = []
          if (size) {
            warnings.push({
              type: 'unsupported',
              feature: 'size',
              details: 'Pass providerOptions.nanogpt.resolution instead.',
            })
          }
          if (mask) warnings.push({ type: 'unsupported', feature: 'mask' })

          const inputReferences = files?.map((file) => {
            const inline = inlineFile(file, 'NanoGPT')
            return `data:${inline.mediaType};base64,${fileBase64(inline)}`
          })

          const body = {
            ...providerOptions?.nanogpt,
            model: modelId,
            prompt,
            n,
            ...(aspectRatio && { aspect_ratio: aspectRatio }),
            ...(inputReferences?.length && { input_references: inputReferences }),
          }

          const response = await settings.fetch(url, {
            method: 'POST',
            headers: {
              ...definedHeaders(headers),
              'Content-Type': 'application/json',
              Authorization: `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: abortSignal,
          })

          const text = await response.text()
          const responseHeaders = Object.fromEntries(response.headers)
          const parsed = parseJson(text)

          if (!response.ok) {
            throw httpError({
              response,
              text,
              url,
              message: errorMessage(parsed, text, response.status),
              requestBodyValues: { ...body, input_references: inputReferences?.length },
            })
          }

          const result = GenerationResponse.safeParse(parsed)
          if (!result.success) {
            throw new InvalidResponseDataError({
              data: text.slice(0, 200),
              message: `NanoGPT returned an unreadable image response: ${text.slice(0, 200)}`,
            })
          }

          const images: string[] = []
          for (const item of result.data.data) {
            if (item.b64_json) {
              images.push(item.b64_json)
            } else if (item.url) {
              images.push(await downloadBase64(settings.fetch, item.url, abortSignal))
            }
          }

          return {
            images,
            ...(images.length === 0 && { isRetryable: false }),
            warnings,
            response: { timestamp: new Date(), modelId, headers: responseHeaders },
          }
        },
      }
    },
  }
}
