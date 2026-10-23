// Helpers shared by the custom `ImageModelV4` adapters.

import { APICallError } from 'ai'
import type { ImageModelV4CallOptions, SharedV4Warning } from '@ai-sdk/provider'
import { base64ToBytes, bytesToBase64 } from '#lib/utils/image.ts'

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** The start of a response body, or its status when the body is empty. */
export const responseExcerpt = (text: string, status: number): string =>
  text.trim().slice(0, 200) || `HTTP ${status}`

/** A failed response as an error the 429 middleware leaves alone. */
export function httpError({
  response,
  text,
  url,
  message,
  requestBodyValues,
}: {
  response: Response
  text: string
  url: string
  message: string
  requestBodyValues?: unknown
}): APICallError {
  return new APICallError({
    message,
    url,
    requestBodyValues,
    statusCode: response.status,
    responseHeaders: Object.fromEntries(response.headers),
    responseBody: text,
    isRetryable: false,
  })
}

/** The caller's headers, minus the ones the SDK left undefined. */
export function definedHeaders(
  headers: ImageModelV4CallOptions['headers'],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  )
}

/** Warnings for the inputs a local backend takes no part in. */
export function unsupportedInputWarnings({
  aspectRatio,
  mask,
}: Pick<ImageModelV4CallOptions, 'aspectRatio' | 'mask'>): SharedV4Warning[] {
  const warnings: SharedV4Warning[] = []
  if (aspectRatio) {
    warnings.push({ type: 'unsupported', feature: 'aspectRatio', details: 'Pass size instead.' })
  }
  if (mask) warnings.push({ type: 'unsupported', feature: 'mask' })
  return warnings
}

export type ReferenceFile = NonNullable<ImageModelV4CallOptions['files']>[number]
type InlineFile = Extract<ReferenceFile, { type: 'file' }>

/** A reference that carries its own data; a URL is refused. */
export function inlineFile(file: ReferenceFile, provider: string): InlineFile {
  if (file.type === 'url') throw new Error(`${provider} image references must be base64.`)
  return file
}

export const fileBase64 = ({ data }: InlineFile): string =>
  typeof data === 'string' ? data : bytesToBase64(data)

export const fileBytes = ({ data }: InlineFile): Uint8Array<ArrayBuffer> =>
  typeof data === 'string' ? base64ToBytes(data) : new Uint8Array(data)
