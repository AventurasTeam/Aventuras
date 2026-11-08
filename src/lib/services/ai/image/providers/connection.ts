import type { ImageProviderConnection, ImageProviderType } from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { PROVIDER_BASE_URL, type BaseUrlRule } from './baseUrls'

type FieldMode = BaseUrlRule['mode']

/**
 * Whether generation needs an API key. A provider that does not still sends one when set, for a
 * server behind an auth proxy. Exhaustive by type, so a new provider has to declare it.
 *
 * Pollinations counts as requiring one: the model list is served without it, but
 * generation is not, and a profile that can list and cannot draw is the worse failure —
 * it looks configured.
 */
const API_KEY_REQUIRED: Record<ImageProviderType, boolean> = {
  nanogpt: true,
  openai: true,
  'openai-compatible': false,
  openrouter: true,
  google: true,
  zhipu: true,
  pollinations: true,
  comfyui: false,
  a1111: false,
}

export const isImageProviderType = (value: string): value is ImageProviderType =>
  Object.hasOwn(API_KEY_REQUIRED, value)

/** Whether a profile of this provider needs an API key to be usable. */
export const requiresApiKey = (providerType: ImageProviderType): boolean =>
  API_KEY_REQUIRED[providerType]

/** Whether a profile of this provider needs, may take, or has no base URL. */
export function baseUrlMode(providerType: ImageProviderType): FieldMode {
  return PROVIDER_BASE_URL[providerType].mode
}

/**
 * The connection a provider is built from. The form keeps a value typed for another provider, so
 * a base URL this one has no input for is dropped rather than saved or sent.
 */
export function imageConnectionFor(
  providerType: ImageProviderType,
  apiKey: string,
  baseUrl: string | undefined,
): ImageProviderConnection {
  return {
    providerType,
    apiKey,
    baseUrl: baseUrlMode(providerType) === 'none' ? undefined : baseUrl,
  } as ImageProviderConnection
}

/** Identifies the connection a model list was loaded for. */
export function modelListKey({ providerType, apiKey, baseUrl }: ImageProviderConnection): string {
  return JSON.stringify([providerType, apiKey, normalizeBaseUrl(baseUrl)])
}
