import type { ImageProviderType } from '#lib/types/index.ts'
import { normalizeBaseUrl } from '#lib/utils/url.ts'

type BaseUrl = `http://${string}` | `https://${string}`

export type BaseUrlRule =
  | { mode: 'required' }
  | { mode: 'optional'; default: BaseUrl }
  | { mode: 'none'; default?: BaseUrl }

// `required` has no endpoint of its own to default to; `none` always runs on its default.
export const PROVIDER_BASE_URL: Record<ImageProviderType, BaseUrlRule> = {
  nanogpt: { mode: 'none', default: 'https://api.nano-gpt.com/api/v1' },
  openai: { mode: 'optional', default: 'https://api.openai.com/v1' },
  'openai-compatible': { mode: 'required' },
  openrouter: { mode: 'none', default: 'https://openrouter.ai/api/v1' },
  google: { mode: 'none', default: 'https://generativelanguage.googleapis.com/v1beta' },
  zhipu: { mode: 'optional', default: 'https://api.z.ai/api/paas/v4' },
  pollinations: { mode: 'none' },
  comfyui: { mode: 'optional', default: 'http://localhost:8188' },
  a1111: { mode: 'optional', default: 'http://localhost:7860' },
}

/** The normalized profile URL, else the provider's default; `''` for a blank `required` one. */
export function resolveBaseUrl(providerType: ImageProviderType, raw: string | undefined): string {
  const rule = PROVIDER_BASE_URL[providerType]
  return normalizeBaseUrl(raw) || (rule.mode === 'required' ? '' : (rule.default ?? ''))
}
