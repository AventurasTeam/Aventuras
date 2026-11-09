// NanoGPT's unified image API (POST {base}/images) as an AI SDK image model. It is a custom model
// because the unified `/images` endpoint and its `input_references` are not the OpenAI image shape.

import * as z from 'zod'
import { InvalidResponseDataError } from 'ai'
import type { ImageModelV4, SharedV4Warning } from '@ai-sdk/provider'
import { providerMessage } from '#lib/utils/error.ts'
import { endpoint } from '#lib/utils/url.ts'
import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import { fetchPublicImageBase64 } from './fetchAdapter'
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
  /** Normalized by the provider factory. */
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

export function createNanoGPTImage(settings: NanoGPTImageSettings) {
  const url = endpoint(settings.baseURL, 'images')

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
              message: providerMessage(text) ?? responseExcerpt(text, response.status),
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
              // A plain Error on failure, not an APICallError: the 429 middleware would otherwise re-run,
              // and re-bill, the generation.
              images.push(
                await fetchPublicImageBase64(item.url, {
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
