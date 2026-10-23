// A1111-compatible `POST {base}/sdapi/v1/txt2img` (A1111, Forge, SD.Next, KoboldCpp) as an AI SDK
// image model. Custom because no maintained SDK provider speaks it; the community package targets
// spec v2, has no `fetch` injection and decodes base64 with `Buffer`.

import * as z from 'zod'
import { InvalidResponseDataError } from 'ai'
import type { ImageModelV4 } from '@ai-sdk/provider'
import type { Fetch } from '#lib/services/ai/sdk/providers/index.ts'
import { parseImageSize } from '#lib/utils/image.ts'
import {
  definedHeaders,
  fileBase64,
  httpError,
  inlineFile,
  parseJson,
  responseExcerpt,
  unsupportedInputWarnings,
} from './imageModelUtils'

interface A1111ImageSettings {
  baseURL: string
  apiKey?: string
  fetch: Fetch
}

const GenerationResponse = z.object({ images: z.array(z.string()) })

// A 422 carries `detail: [{ msg }]`; every other failure goes through the server's handler, which
// answers `detail: '<message>'` for an `HTTPException` and `errors: str(exception)` otherwise.
const ErrorBody = z.object({
  detail: z
    .union([z.string(), z.array(z.object({ msg: z.string() }))])
    .optional()
    .catch(undefined),
  errors: z.string().optional().catch(undefined),
})

function errorMessage(parsed: unknown, text: string, status: number): string {
  const body = ErrorBody.safeParse(parsed)
  if (body.success) {
    const { detail, errors } = body.data
    const found = (typeof detail === 'string' ? detail : detail?.[0]?.msg) || errors
    if (found) return found
  }
  return responseExcerpt(text, status)
}

export function createA1111Image(settings: A1111ImageSettings) {
  const url = `${settings.baseURL.replace(/\/+$/, '')}/sdapi/v1/txt2img`

  return {
    imageModel(modelId: string): ImageModelV4 {
      return {
        specificationVersion: 'v4',
        provider: 'a1111.image',
        modelId,
        maxImagesPerCall: 1,
        supportsFileInputs: true,
        supportsMaskInputs: false,

        async doGenerate({
          prompt,
          size,
          aspectRatio,
          seed,
          files,
          mask,
          providerOptions,
          abortSignal,
          headers,
        }) {
          const dimensions = parseImageSize(size)
          if (!dimensions) throw new Error('A1111 image generation needs a WxH size.')

          const warnings = unsupportedInputWarnings({ aspectRatio, mask })

          // Reference images for edit models (Kontext, Qwen Image Edit); a plain checkpoint ignores them.
          const extraImages = files?.map((file) => fileBase64(inlineFile(file, 'A1111')))

          // A checkpoint chosen per request is put back afterwards, so it does not stay loaded as
          // the server's default.
          const body = {
            ...providerOptions?.a1111,
            prompt,
            ...dimensions,
            seed: seed ?? -1,
            batch_size: 1,
            n_iter: 1,
            ...(extraImages?.length && { extra_images: extraImages }),
            ...(modelId && {
              override_settings: { sd_model_checkpoint: modelId },
              override_settings_restore_afterwards: true,
            }),
          }

          const response = await settings.fetch(url, {
            method: 'POST',
            headers: {
              ...definedHeaders(headers),
              'Content-Type': 'application/json',
              ...(settings.apiKey && { Authorization: `Bearer ${settings.apiKey}` }),
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
              requestBodyValues: { ...body, extra_images: undefined },
            })
          }

          const result = GenerationResponse.safeParse(parsed)
          if (!result.success) {
            throw new InvalidResponseDataError({
              data: text.slice(0, 200),
              message: `A1111 returned an unreadable image response: ${text.slice(0, 200)}`,
            })
          }

          const { images } = result.data
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
