import type { ImageProviderConnection, ImageProviderType } from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'
import { PROVIDER_BASE_URL, type BaseUrlRule } from './baseUrls'

type FieldMode = BaseUrlRule['mode']

/**
 * How a provider uses an API key: `required` for the hosted ones, `optional` for an endpoint
 * the user runs or fronts themselves, `none` for the ones that run on the user's own machine.
 * Exhaustive by type, so a new provider has to declare which it is.
 *
 * Pollinations counts as requiring one: the model list is served without it, but
 * generation is not, and a profile that can list and cannot draw is the worse failure —
 * it looks configured.
 */
const PROVIDER_API_KEY: Record<ImageProviderType, FieldMode> = {
  nanogpt: 'required',
  openai: 'required',
  'openai-compatible': 'optional',
  openrouter: 'required',
  google: 'required',
  zhipu: 'required',
  pollinations: 'required',
  comfyui: 'none',
  a1111: 'none',
}

export const isImageProviderType = (value: string): value is ImageProviderType =>
  Object.hasOwn(PROVIDER_API_KEY, value)

/** Whether a profile of this provider needs an API key to be usable. */
export function requiresApiKey(providerType: ImageProviderType): boolean {
  return PROVIDER_API_KEY[providerType] === 'required'
}

/** Whether a profile of this provider has an API key field at all. */
export function takesApiKey(providerType: ImageProviderType): boolean {
  return PROVIDER_API_KEY[providerType] !== 'none'
}

/** Whether a profile of this provider needs, may take, or has no base URL. */
export function baseUrlMode(providerType: ImageProviderType): FieldMode {
  return PROVIDER_BASE_URL[providerType].mode
}

/**
 * The connection a provider is built from. The form keeps a value typed for another provider, so
 * a field this one has no input for is dropped rather than saved or sent.
 */
export function imageConnectionFor(
  providerType: ImageProviderType,
  apiKey: string,
  baseUrl: string | undefined,
): ImageProviderConnection {
  return {
    providerType,
    apiKey: takesApiKey(providerType) ? apiKey : '',
    baseUrl: baseUrlMode(providerType) === 'none' ? undefined : baseUrl,
  } as ImageProviderConnection
}

/** Identifies the connection a model list was loaded for. */
export function modelListKey({ providerType, apiKey, baseUrl }: ImageProviderConnection): string {
  return JSON.stringify([providerType, apiKey, normalizeBaseUrl(baseUrl)])
}
