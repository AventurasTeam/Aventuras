// NanoGPT's unified image API (POST {base}/images) as an AI SDK image model. NanoGPT answers
// `data[].b64_json`, which @ai-sdk/openai-compatible would accept, but a `url`-only item it would reject.

import * as z from 'zod'
import { APICallError, InvalidResponseDataError } from 'ai'
import type { ImageModelV4, SharedV4Warning } from '@ai-sdk/provider'
import { bytesToBase64 } from '#lib/utils/image.ts'
import { fetchImageBase64 } from './fetchAdapter'

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

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
  return text.trim().slice(0, 200) || `HTTP ${status}`
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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
            if (file.type === 'url') throw new Error('NanoGPT image references must be base64.')
            const data = typeof file.data === 'string' ? file.data : bytesToBase64(file.data)
            return `data:${file.mediaType};base64,${data}`
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
              ...Object.fromEntries(
                Object.entries(headers ?? {}).filter(([, v]) => v !== undefined),
              ),
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
            throw new APICallError({
              message: errorMessage(parsed, text, response.status),
              url,
              requestBodyValues: { ...body, input_references: inputReferences?.length },
              statusCode: response.status,
              responseHeaders,
              responseBody: text,
              isRetryable: false,
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
              images.push(
                await fetchImageBase64(item.url, {
                  signal: abortSignal,
                  serviceId: 'nanogpt-image-download',
                }),
              )
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
