/**
 * Model Fetcher
 *
 * Fetches available models from AI providers.
 */

import type { ProviderType, TextModel } from '$lib/types'
import { dedupeTextModels } from '$lib/utils/dedupeTextModels'
import { createTimeoutFetch } from './fetch'
import { PROVIDERS, getBaseUrl } from './config'

/** URLs that don't require authentication for model fetching */
const NO_AUTH_PATTERNS = ['nano-gpt.com', 'gen.pollinations.ai', '127.0.0.1', 'localhost']

function normalizeBaseUrl(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim()
  return trimmed ? trimmed.replace(/\/$/, '') : undefined
}

function buildOpenRouterModelsUrl(baseUrl?: string): string {
  const effectiveBase = normalizeBaseUrl(baseUrl) || 'https://openrouter.ai/api/v1'
  if (effectiveBase.endsWith('/api')) {
    return `${effectiveBase}/v1/models`
  }
  return `${effectiveBase}/models`
}

/**
 * Fetches available models from a provider.
 */
export async function fetchModelsFromProvider(
  providerType: ProviderType,
  baseUrl?: string,
  apiKey?: string,
): Promise<TextModel[]> {
  // Provider-specific fetch logic
  if (providerType === 'nanogpt') return fetchNanogptModels(baseUrl)
  if (providerType === 'openrouter') return fetchOpenRouterModels(baseUrl)
  if (providerType === 'google') return fetchGoogleModels(baseUrl, apiKey)
  if (providerType === 'anthropic') return wrap(fetchAnthropicModels(baseUrl, apiKey))
  if (providerType === 'chutes') return wrap(fetchChutesModels(baseUrl, apiKey))
  if (providerType === 'ollama') return wrap(fetchOllamaModels(baseUrl))
  if (providerType === 'zhipu') return wrap(fetchZhipuModels(baseUrl, apiKey))
  if (providerType === 'mistral') return wrap(fetchMistralModels(baseUrl, apiKey))
  if (providerType === 'pollinations') return fetchPollinationsTextModels()

  if (providerType === 'nvidia-nim') return fetchNimModels(baseUrl, apiKey)

  // Standard OpenAI-compatible endpoint
  const effectiveBaseUrl = normalizeBaseUrl(baseUrl) || getBaseUrl(providerType)
  if (!effectiveBaseUrl) {
    throw new Error(`No base URL available for provider: ${providerType}`)
  }

  const requiresAuth = !NO_AUTH_PATTERNS.some((p) => effectiveBaseUrl.toLowerCase().includes(p))
  const fetch = createTimeoutFetch(30000, 'model-fetch')
  const modelsUrl = effectiveBaseUrl.replace(/\/$/, '') + '/models'

  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers: requiresAuth && apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (data.data && Array.isArray(data.data)) {
    return dedupeTextModels(data.data.map((m: { id: string }) => ({ id: m.id })))
  }
  if (Array.isArray(data)) {
    const entries = data as { id?: string; name?: string }[]
    return dedupeTextModels(entries.map((m) => ({ id: m.id || m.name || '' })))
  }

  throw new Error('Unexpected API response format')
}

/** Wrap a plain string[] result into TextModel[] */
function wrap(promise: Promise<string[]>): Promise<TextModel[]> {
  return promise.then((models) => dedupeTextModels(models.map((id) => ({ id }))))
}

// Substrings that, when found in a NIM model ID, identify non-text-generation models
// that should be excluded at fetch time.
const NIM_EXCLUDE_PATTERNS: readonly string[] = [
  // Embedding / retrieval
  'embed', // nv-embed, embed-qa, nemoretriever-embed, arctic-embed, …
  'retriever', // nemoretriever-*
  'bge-', // BAAI General Embedding (bge-m3)
  // Guard / safety classifiers
  'guard', // llama-guard, nemoguard, safety-guard
  'shield', // shieldgemma
  'safety', // content-safety, nemotron-content-safety
  'gliner', // gliner-pii
  // Reward models
  'reward',
  // Vision-only / multimodal
  'vision', // vision-instruct, phi-3-vision
  'multimodal', // phi-4-multimodal
  '-vl-', // vision-language flag (nemotron-nano-vl)
  'vlm', // vlm-embed
  'nvclip', // NVIDIA CLIP
  'paligemma', // Google PaLiGemma
  'kosmos', // Microsoft Kosmos-2
  'deplot', // Google DePlot
  'fuyu', // Adept Fuyu-8b
  'neva-', // NVIDIA NEVA (neva-22b)
  'vila', // NVIDIA VILA
  '-parse', // document-parsing services (nemotron-parse, nemoretriever-parse)
  'video', // video analysis / detection models
  'calibration', // physics/optimization tools (ising-calibration)
  // Code models (not useful for interactive fiction)
  'code', // starcoder, codellama, codegemma, codestral, deepseek-coder, granite-code, …
  // Specialist / domain models
  'med', // medical (palmyra-med)
  'fin', // financial (palmyra-fin)
  'chatqa', // Q&A specialist (llama3-chatqa)
]

/**
 * Returns the largest parameter count in billions found in a NIM model ID,
 * or null if none is detectable.
 *
 * Handles:
 *   - Integer sizes:  `-8b`, `-70b`, `-340b`
 *   - Decimal sizes:  `-10.7b`, `-6.7b`
 *   - Embedded sizes: `e4b` (gemma-3n-e4b), `starcoder2-15b`
 *
 * Skips version numbers like `3.1` in `llama-3.1-8b` because the lookbehind
 * `(?<![.\d])` rejects digits/dots before the match.
 */
function nimLargestSizeB(modelId: string): number | null {
  const lower = modelId.toLowerCase()
  const intHits = [...lower.matchAll(/(?<![.\d])(\d+)b(?!\d)/g)].map((m) => parseInt(m[1], 10))
  const decHits = [...lower.matchAll(/(?<!\d)(\d+\.\d+)b(?!\d)/g)].map((m) => parseFloat(m[1]))
  const all = [...intHits, ...decHits]
  return all.length > 0 ? Math.max(...all) : null
}

function isNimTextGenModel(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  if (NIM_EXCLUDE_PATTERNS.some((p) => lower.includes(p))) return false
  const size = nimLargestSizeB(modelId)
  return size === null || size >= 24
}

async function fetchNimModels(baseUrl?: string, apiKey?: string): Promise<TextModel[]> {
  const effectiveBaseUrl = normalizeBaseUrl(baseUrl) || 'https://integrate.api.nvidia.com/v1'
  const fetch = createTimeoutFetch(30000, 'model-fetch')
  const response = await fetch(`${effectiveBaseUrl}/models`, {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch NIM models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const raw: { id: string }[] = data.data && Array.isArray(data.data) ? data.data : []
  return dedupeTextModels(raw.filter((m) => isNimTextGenModel(m.id)).map((m) => ({ id: m.id })))
}

interface NanogptModelEntry {
  model: string
  name?: string
  capabilities?: string[]
}

async function fetchNanogptModels(baseUrl?: string): Promise<TextModel[]> {
  // Use the detailed API to get capabilities including reasoning
  const effectiveBase = baseUrl?.replace(/\/v1\/?$/, '') || 'https://nano-gpt.com/api'
  const modelsUrl = effectiveBase.replace(/\/$/, '') + '/models?detailed=true'

  const fetchFn = createTimeoutFetch(30000, 'model-fetch')
  const response = await fetchFn(modelsUrl, { method: 'GET' })

  if (!response.ok) {
    throw new Error(`Failed to fetch NanoGPT models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const textModels: Record<string, NanogptModelEntry> = data?.models?.text ?? {}

  const models: TextModel[] = []

  for (const [key, entry] of Object.entries(textModels)) {
    const modelId = entry.model || key
    models.push({
      id: modelId,
      reasoning: entry.capabilities?.includes('reasoning'),
      structuredOutput: entry.capabilities?.includes('structured-output'),
    })
  }

  return dedupeTextModels(models)
}

async function fetchOpenRouterModels(baseUrl?: string): Promise<TextModel[]> {
  // Use the detailed API to get capabilities including reasoning
  const modelsUrl = buildOpenRouterModelsUrl(baseUrl)

  const fetchFn = createTimeoutFetch(30000, 'model-fetch')
  const response = await fetchFn(modelsUrl, { method: 'GET' })

  if (!response.ok) {
    throw new Error(`Failed to fetch OpenRouter models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  const textModels: { id: string; supported_parameters: string[] }[] = data?.data ?? []

  const models: TextModel[] = []

  for (const entry of textModels) {
    const modelId = entry.id
    models.push({
      id: modelId,
      reasoning: entry.supported_parameters?.includes('reasoning'),
      structuredOutput: entry.supported_parameters?.includes('structured_outputs'),
    })
  }

  return dedupeTextModels(models)
}

async function fetchAnthropicModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
  const effectiveBaseUrl = baseUrl || 'https://api.anthropic.com/v1'
  const modelsUrl = effectiveBaseUrl.replace(/\/$/, '') + '/models'

  try {
    const fetchFn = createTimeoutFetch(30000, 'model-fetch')
    const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' }
    if (apiKey) headers['x-api-key'] = apiKey

    const response = await fetchFn(modelsUrl, { method: 'GET', headers })

    if (!response.ok) {
      console.warn(
        `[ModelFetcher] Anthropic API returned ${response.status}, using fallback models`,
      )
      return PROVIDERS.anthropic.fallbackModels
    }

    const data = await response.json()
    if (data.data && Array.isArray(data.data)) {
      const models = data.data.map((m: { id: string }) => m.id).filter(Boolean)
      if (models.length > 0) return models
    }

    return PROVIDERS.anthropic.fallbackModels
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Anthropic models:', error)
    return PROVIDERS.anthropic.fallbackModels
  }
}

interface GoogleModelEntry {
  name: string
  supportedGenerationMethods?: string[]
  thinking?: boolean
}

/**
 * Fetches models from Google AI Studio.
 *
 * Example API response for a reasoning model (Gemini 3.1):
 * {
 *   "name": "models/gemini-3.1-pro-preview",
 *   "version": "3.1-pro-preview-01-2026",
 *   "displayName": "Gemini 3.1 Pro Preview",
 *   "supportedGenerationMethods": ["generateContent", ...],
 *   "thinking": true
 * }
 */
async function fetchGoogleModels(baseUrl?: string, apiKey?: string): Promise<TextModel[]> {
  const effectiveBaseUrl = baseUrl || 'https://generativelanguage.googleapis.com/v1beta'

  if (!apiKey) {
    console.warn('[ModelFetcher] Google API key required, using fallback models')
    return getGoogleFallback()
  }

  const modelsUrl = effectiveBaseUrl.replace(/\/$/, '') + '/models?key=' + apiKey

  try {
    const fetchFn = createTimeoutFetch(30000, 'model-fetch')
    const response = await fetchFn(modelsUrl, { method: 'GET' })

    if (!response.ok) {
      console.warn(`[ModelFetcher] Google API returned ${response.status}, using fallback models`)
      return getGoogleFallback()
    }

    const data = await response.json()
    if (data.models && Array.isArray(data.models)) {
      const models = (data.models as GoogleModelEntry[])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => {
          const id = m.name.replace(/^models\//, '')
          // Gemini 2.5 uses thinkingBudget (token count), Gemini 3.x uses thinkingLevel
          // Gemini 2.0 has no thinking support (API returns thinking: undefined)
          const isGemini25 = id.includes('gemini-2.5')
          return {
            id,
            reasoning: m.thinking ?? false,
            isBudgetReasoning: isGemini25,
          }
        })
        .filter((m) => !!m.id)
      if (models.length > 0) return dedupeTextModels(models)
    }

    return getGoogleFallback()
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Google models:', error)
    return getGoogleFallback()
  }
}

async function fetchChutesModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
  if (!apiKey) {
    throw new Error('Chutes requires an API key to fetch models')
  }

  const effectiveBaseUrl = 'https://api.chutes.ai'
  const chutesUrl = effectiveBaseUrl.replace(/\/$/, '') + '/chutes/?include_public=true&limit=200'

  const fetchFn = createTimeoutFetch(30000, 'model-fetch')
  const response = await fetchFn(chutesUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch Chutes models: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  if (data.items && Array.isArray(data.items)) {
    return data.items
      .filter(
        (r: { standard_template?: string; user?: { username: string } }) =>
          r.standard_template?.includes('llm') && r.user?.username === 'chutes',
      )
      .map(({ name }: { name?: string }) => name || '')
  }

  throw new Error('Unexpected Chutes API response format')
}

async function fetchOllamaModels(baseUrl?: string): Promise<string[]> {
  const effectiveBaseUrl = baseUrl || PROVIDERS.ollama.baseUrl
  const tagsUrl = effectiveBaseUrl.replace(/\/$/, '').replace(/\/api$/, '') + '/api/tags'

  try {
    const fetchFn = createTimeoutFetch(10000, 'model-fetch')
    const response = await fetchFn(tagsUrl, { method: 'GET' })

    if (!response.ok) {
      console.warn(`[ModelFetcher] Ollama returned ${response.status}, using fallback models`)
      return PROVIDERS.ollama.fallbackModels
    }

    const data = await response.json()
    if (data.models && Array.isArray(data.models)) {
      const models = data.models
        .map((m: { name?: string; model?: string }) => m.name || m.model || '')
        .filter(Boolean)
      if (models.length > 0) return models
    }

    return PROVIDERS.ollama.fallbackModels
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Ollama models (is Ollama running?):', error)
    return PROVIDERS.ollama.fallbackModels
  }
}

async function fetchZhipuModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
  if (!apiKey) {
    console.warn('[ModelFetcher] Zhipu API key required, using fallback models')
    return PROVIDERS.zhipu.fallbackModels
  }

  const effectiveBaseUrl = baseUrl || PROVIDERS.zhipu.baseUrl
  const modelsUrl = effectiveBaseUrl.replace(/\/$/, '') + '/models'

  try {
    const fetchFn = createTimeoutFetch(30000, 'model-fetch')
    const response = await fetchFn(modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!response.ok) {
      console.warn(`[ModelFetcher] Zhipu API returned ${response.status}, using fallback models`)
      return PROVIDERS.zhipu.fallbackModels
    }

    const data = await response.json()
    if (data.data && Array.isArray(data.data)) {
      const models = data.data.map((m: { id?: string }) => m.id || '').filter(Boolean)
      if (models.length > 0) return models
    }

    return PROVIDERS.zhipu.fallbackModels
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Zhipu models:', error)
    return PROVIDERS.zhipu.fallbackModels
  }
}

async function fetchMistralModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
  if (!apiKey) {
    console.warn('[ModelFetcher] Mistral API key required, using fallback models')
    return PROVIDERS.mistral.fallbackModels
  }

  const effectiveBaseUrl = baseUrl || PROVIDERS.mistral.baseUrl
  const modelsUrl = effectiveBaseUrl.replace(/\/$/, '') + '/models'

  try {
    const fetchFn = createTimeoutFetch(30000, 'model-fetch')
    const response = await fetchFn(modelsUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!response.ok) {
      console.warn(`[ModelFetcher] Mistral API returned ${response.status}, using fallback models`)
      return PROVIDERS.mistral.fallbackModels
    }

    const data = await response.json()
    if (data.data && Array.isArray(data.data)) {
      const models = data.data.map((m: { id?: string }) => m.id || '').filter(Boolean)
      if (models.length > 0) return models
    }

    return PROVIDERS.mistral.fallbackModels
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Mistral models:', error)
    return PROVIDERS.mistral.fallbackModels
  }
}

interface PollinationsTextModelResponse {
  name: string
  is_specialized?: boolean
  paid_only?: boolean
  reasoning?: boolean
  input_modalities?: string[]
  output_modalities?: string[]
}

async function fetchPollinationsTextModels(): Promise<TextModel[]> {
  const url = 'https://gen.pollinations.ai/text/models'
  const fetchFn = createTimeoutFetch(30000, 'model-fetch')

  try {
    const response = await fetchFn(url, { method: 'GET' })
    if (!response.ok) return getPollinationsTextFallback()

    const data = await response.json()
    if (!Array.isArray(data)) return getPollinationsTextFallback()

    const models: TextModel[] = (data as PollinationsTextModelResponse[])
      .filter(
        (m) =>
          !m.is_specialized &&
          !m.paid_only &&
          (m.input_modalities?.includes('text') ?? true) &&
          (m.output_modalities?.includes('text') ?? true),
      )
      .map((m) => ({
        id: m.name,
        reasoning: m.reasoning ?? false,
      }))

    return models.length > 0 ? dedupeTextModels(models) : getPollinationsTextFallback()
  } catch (error) {
    console.warn('[ModelFetcher] Failed to fetch Pollinations text models:', error)
    return getPollinationsTextFallback()
  }
}

function getGoogleFallback(): TextModel[] {
  return dedupeTextModels(PROVIDERS.google.fallbackModels.map((id) => ({ id })))
}

function getPollinationsTextFallback(): TextModel[] {
  return dedupeTextModels(PROVIDERS.pollinations.fallbackModels.map((id) => ({ id })))
}
