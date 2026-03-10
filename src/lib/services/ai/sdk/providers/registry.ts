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
import { createPollinations } from 'ai-sdk-pollinations'
import { createXai } from '@ai-sdk/xai'
import { createGroq } from '@ai-sdk/groq'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createMistral } from '@ai-sdk/mistral'

import type { APIProfile } from '$lib/types'
import { createTimeoutFetch } from './fetch'
import { PROVIDERS, getBaseUrl } from './config'
import { settings } from '$lib/stores/settings.svelte'

export function createProviderFromProfile(options: {
  profile: APIProfile
  presetId: string
  debugId?: string
  structuredOutputs?: boolean
  manualBody?: string
}) {
  const { profile, presetId, debugId, structuredOutputs, manualBody } = options
  const fetch = createTimeoutFetch(settings.apiSettings.llmTimeoutMs, presetId, manualBody, debugId)
  const baseURL = profile.baseUrl || getBaseUrl(profile.providerType)
  const supportsStructuredOutputs = structuredOutputs ?? false

  switch (profile.providerType) {
    case 'openrouter':
      return createOpenRouter({
        compatibility: 'strict',
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
        supportsStructuredOutputs,
        fetch,
      })

    case 'chutes':
      return createOpenAICompatible({
        name: 'chutes',
        apiKey: profile.apiKey,
        baseURL: baseURL ?? PROVIDERS.chutes.baseUrl,
        supportsStructuredOutputs,
        fetch,
      })

    case 'pollinations':
      return createPollinations({ apiKey: profile.apiKey || undefined, fetch })

    case 'ollama':
      return createOpenAICompatible({
        name: 'ollama',
        apiKey: 'ollama',
        baseURL: baseURL ?? PROVIDERS.ollama.baseUrl,
        supportsStructuredOutputs,
        fetch,
      })

    case 'lmstudio':
      return createOpenAICompatible({
        name: 'lmstudio',
        apiKey: profile.apiKey || 'lm-studio',
        baseURL: baseURL ?? PROVIDERS.lmstudio.baseUrl,
        supportsStructuredOutputs,
        fetch,
      })

    case 'llamacpp':
      return createOpenAICompatible({
        name: 'llamacpp',
        apiKey: profile.apiKey || 'llamacpp',
        baseURL: baseURL ?? PROVIDERS.llamacpp.baseUrl,
        supportsStructuredOutputs,
        fetch,
      })

    case 'nvidia-nim':
      return createOpenAICompatible({
        name: 'nvidia-nim',
        apiKey: profile.apiKey,
        baseURL: baseURL ?? PROVIDERS['nvidia-nim'].baseUrl,
        supportsStructuredOutputs,
        fetch,
      })

    case 'openai-compatible':
      if (!baseURL) {
        throw new Error('OpenAI-compatible provider requires a custom base URL')
      }
      return createOpenAICompatible({
        name: 'openai-compatible',
        apiKey: profile.apiKey ?? 'openai-compatible',
        baseURL,
        supportsStructuredOutputs,
        fetch,
      })

    case 'xai':
      return createXai({ apiKey: profile.apiKey, baseURL, fetch })

    case 'groq':
      return createGroq({ apiKey: profile.apiKey, baseURL, fetch })

    case 'zhipu':
      if (!baseURL) {
        throw new Error('Zhipu provider requires a custom base URL') // It does not
      }
      return createOpenAICompatible({ name: 'zhipu', apiKey: profile.apiKey, baseURL, fetch })

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
