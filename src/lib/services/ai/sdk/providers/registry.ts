/**
 * Provider Registry
 *
 * Creates Vercel AI SDK providers from APIProfile.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createChutes } from '@chutes-ai/ai-sdk-provider'
import { createPollinations } from 'ai-sdk-pollinations'
import { createXai } from '@ai-sdk/xai'
import { createGroq } from '@ai-sdk/groq'
import { createZhipu } from 'zhipu-ai-provider'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createMistral } from '@ai-sdk/mistral'

import type { APIProfile } from '$lib/types'
import { createTimeoutFetch } from './fetch'
import { PROVIDERS, getBaseUrl } from './config'

const DEFAULT_TIMEOUT_MS = 180000

export function createProviderFromProfile(profile: APIProfile, presetId: string, debugId?: string) {
  const fetch = createTimeoutFetch(DEFAULT_TIMEOUT_MS, presetId, debugId)
  const baseURL = profile.baseUrl || getBaseUrl(profile.providerType)

  switch (profile.providerType) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: profile.apiKey,
        baseURL: baseURL ?? PROVIDERS.openrouter.baseUrl,
        headers: { 'HTTP-Referer': 'https://aventura.camp', 'X-Title': 'Aventura' },
        fetch,
      })

    case 'openai':
      return createOpenAI({ apiKey: profile.apiKey, baseURL, fetch })

    case 'anthropic':
      return createAnthropic({ apiKey: profile.apiKey, baseURL, fetch })

    case 'google':
      return createGoogleGenerativeAI({ apiKey: profile.apiKey, baseURL, fetch })

    case 'nanogpt':
      // Use OpenAI-compatible provider for proper reasoning support
      return createOpenAICompatible({
        name: 'nanogpt',
        apiKey: profile.apiKey,
        baseURL: baseURL ?? PROVIDERS.nanogpt.baseUrl,
        fetch,
      })

    case 'chutes':
      return createChutes({ apiKey: profile.apiKey, fetch })

    case 'pollinations':
      return createPollinations({ apiKey: profile.apiKey || undefined, fetch })

    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        apiKey: 'ollama',
        baseURL: baseURL ?? PROVIDERS.ollama.baseUrl,
        fetch,
      })

    case 'lmstudio':
      return createOpenAICompatible({
        name: 'lmstudio',
        apiKey: profile.apiKey || 'lm-studio',
        baseURL: baseURL ?? PROVIDERS.lmstudio.baseUrl,
        fetch,
      })

    case 'llamacpp':
      return createOpenAICompatible({
        name: 'llamacpp',
        apiKey: profile.apiKey || 'llamacpp',
        baseURL: baseURL ?? PROVIDERS.llamacpp.baseUrl,
        fetch,
      })

    case 'nvidia-nim':
      return createOpenAICompatible({
        name: 'nvidia-nim',
        apiKey: profile.apiKey,
        baseURL: baseURL ?? PROVIDERS['nvidia-nim'].baseUrl,
        fetch,
      })

    case 'openai-compatible':
      if (!baseURL) {
        throw new Error('OpenAI-compatible provider requires a custom base URL')
      }
      return createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: profile.apiKey,
        baseURL,
        fetch,
      })

    case 'xai':
      return createXai({ apiKey: profile.apiKey, baseURL, fetch })

    case 'groq':
      return createGroq({ apiKey: profile.apiKey, baseURL, fetch })

    case 'zhipu':
      return createZhipu({ apiKey: profile.apiKey, baseURL, fetch })

    case 'deepseek':
      return createDeepSeek({ apiKey: profile.apiKey, baseURL, fetch })

    case 'mistral':
      return createMistral({ apiKey: profile.apiKey, baseURL, fetch })

    default: {
      const _exhaustive: never = profile.providerType
      throw new Error(`Unknown provider type: ${_exhaustive}`)
    }
  }
}
