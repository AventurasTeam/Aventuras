// Helpers shared by the custom `ImageModelV4` adapters.

import { APICallError } from 'ai'
import type { ImageModelV4CallOptions, SharedV4Warning } from '@ai-sdk/provider'

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

/** Warnings for the inputs a text-to-image backend takes no part in. */
export function unsupportedInputWarnings({
  aspectRatio,
  files,
  mask,
}: Pick<ImageModelV4CallOptions, 'aspectRatio' | 'files' | 'mask'>): SharedV4Warning[] {
  const warnings: SharedV4Warning[] = []
  if (aspectRatio) {
    warnings.push({ type: 'unsupported', feature: 'aspectRatio', details: 'Pass size instead.' })
  }
  if (files?.length) warnings.push({ type: 'unsupported', feature: 'files' })
  if (mask) warnings.push({ type: 'unsupported', feature: 'mask' })
  return warnings
}
