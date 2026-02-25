/**
 * Unified Generate Functions
 *
 * Central module for all AI generation operations using the Vercel AI SDK.
 * Uses explicit provider selection from APIProfile.providerType.
 */

import {
  extractJsonMiddleware,
  extractReasoningMiddleware,
  generateText,
  streamText,
  Output,
  wrapLanguageModel,
} from 'ai'
import type { LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'

import { settings } from '$lib/stores/settings.svelte'
import type { ProviderType, GenerationPreset, ReasoningEffort, APIProfile } from '$lib/types'
import { createLogger } from '../core/config'
import { createProviderFromProfile } from './providers'
import { PROVIDERS } from './providers/config'
import { promptSchemaMiddleware, patchResponseMiddleware, loggingMiddleware } from './middleware'
import { ui } from '$lib/stores/ui.svelte'

const log = createLogger('Generate')

// ============================================================================
// Types
// ============================================================================

type JSONValue = null | string | number | boolean | JSONObject | JSONValue[]
type JSONObject = { [key: string]: JSONValue | undefined }

interface BaseGenerateOptions {
  presetId: string
  system: string
  prompt: string
  signal?: AbortSignal
}

interface GenerateObjectOptions<T extends z.ZodType> extends BaseGenerateOptions {
  schema: T
}

// ============================================================================
// Provider Options
// ============================================================================

const PROVIDER_OPTIONS_KEY: Record<ProviderType, string> = {
  openrouter: 'openrouter',
  nanogpt: 'nanogpt',
  chutes: 'chutes',
  pollinations: 'pollinations',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
  llamacpp: 'llamacpp',
  'nvidia-nim': 'openai',
  'openai-compatible': 'openai',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  groq: 'groq',
  zhipu: 'zhipu',
  deepseek: 'deepseek',
  mistral: 'mistral',
}

const REASONING_TOKEN_BUDGETS: Record<ReasoningEffort, number> = {
  off: 0,
  low: 4000,
  medium: 8000,
  high: 16000,
}

/**
 * Build provider-specific options from preset settings.
 */
export function buildProviderOptions(
  preset: GenerationPreset,
  providerType: ProviderType,
): ProviderOptions | undefined {
  const options: JSONObject = {}

  if (preset.reasoningEffort && preset.reasoningEffort !== 'off') {
    const budgetTokens = REASONING_TOKEN_BUDGETS[preset.reasoningEffort] ?? 8000

    switch (providerType) {
      case 'openrouter':
        // OpenRouter uses max_tokens for reasoning budget
        options.reasoning = { max_tokens: budgetTokens }
        break
      case 'openai':
        options.reasoningEffort = preset.reasoningEffort
        break
      case 'anthropic':
        options.thinking = {
          type: 'enabled',
          budgetTokens,
        }
        break
    }
  }

  if (preset.manualBody) {
    try {
      const manual = JSON.parse(preset.manualBody) as JSONObject
      const reservedKeys = ['messages', 'tools', 'tool_choice', 'stream', 'model']
      if (manual && typeof manual === 'object' && !Array.isArray(manual)) {
        for (const [key, value] of Object.entries(manual)) {
          if (!reservedKeys.includes(key)) {
            options[key] = value
          }
        }
      }
    } catch {
      log('Invalid manualBody JSON, skipping')
    }
  }

  if (Object.keys(options).length === 0) {
    return undefined
  }

  const providerKey = PROVIDER_OPTIONS_KEY[providerType]
  return { [providerKey]: options } as ProviderOptions
}

// ============================================================================
// Config Resolution
// ============================================================================

interface ResolvedConfig {
  preset: GenerationPreset
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV3
  providerOptions: ProviderOptions | undefined
  supportsStructuredOutput: boolean
}

interface NarrativeConfig {
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV3
  temperature: number
  maxTokens: number
  providerOptions: ProviderOptions | undefined
}

function resolveConfig(presetId: string, serviceId: string, debugId?: string): ResolvedConfig {
  const preset = settings.getPresetConfig(presetId, serviceId)
  const profileId = preset.profileId ?? settings.apiSettings.mainNarrativeProfileId
  const profile = settings.getProfile(profileId)

  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  const provider = createProviderFromProfile(profile, serviceId, debugId)
  const model = provider(preset.model) as LanguageModelV3
  const capabilities = PROVIDERS[profile.providerType].capabilities

  return {
    preset,
    profile,
    providerType: profile.providerType,
    model,
    providerOptions: buildProviderOptions(preset, profile.providerType),
    supportsStructuredOutput: capabilities?.structuredOutput ?? true,
  }
}

function resolveNarrativeConfig(debugId?: string): NarrativeConfig {
  const profile = settings.getMainNarrativeProfile()

  if (!profile) {
    throw new Error(
      'Main narrative profile not configured. Please set up an API profile in Settings.',
    )
  }

  const provider = createProviderFromProfile(profile, 'narrative', debugId)
  const baseModelId = settings.apiSettings.defaultModel
  const reasoningEffort = settings.apiSettings.reasoningEffort ?? 'off'
  const model = provider(baseModelId) as LanguageModelV3

  const narrativePreset: GenerationPreset = {
    id: '_narrative',
    name: 'Narrative',
    description: 'Main narrative generation',
    profileId: profile.id,
    model: baseModelId,
    temperature: settings.apiSettings.temperature,
    maxTokens: settings.apiSettings.maxTokens,
    reasoningEffort: reasoningEffort,
    manualBody: '',
  }

  return {
    profile,
    providerType: profile.providerType,
    model,
    temperature: settings.apiSettings.temperature,
    maxTokens: settings.apiSettings.maxTokens,
    providerOptions: buildProviderOptions(narrativePreset, profile.providerType),
  }
}

// ============================================================================
// Middleware
// ============================================================================

function createJsonExtractMiddleware(): LanguageModelV3Middleware {
  return extractJsonMiddleware({
    transform: (text) => {
      try {
        const repaired = jsonrepair(text)
        if (repaired !== text) {
          log('JSON repaired by jsonrepair')
        }
        return repaired
      } catch (e) {
        log('jsonrepair failed:', e)
        return text
      }
    },
  })
}

function buildStructuredMiddleware(supportsStructuredOutput: boolean): LanguageModelV3Middleware[] {
  const base = [patchResponseMiddleware(), createJsonExtractMiddleware(), loggingMiddleware()]
  if (supportsStructuredOutput) {
    return base
  }
  return [
    patchResponseMiddleware(),
    promptSchemaMiddleware(),
    createJsonExtractMiddleware(),
    loggingMiddleware(),
  ]
}

function buildPlainTextMiddleware(): LanguageModelV3Middleware[] {
  return [patchResponseMiddleware(), loggingMiddleware()]
}

/**
 * Build middleware for narrative generation with reasoning support.
 * Includes extractReasoningMiddleware for models that use <think> tags.
 */
function buildNarrativeMiddleware(): LanguageModelV3Middleware[] {
  return [
    patchResponseMiddleware(),
    // Extract reasoning from <think> tags for models like DeepSeek R1, Mistral Magistral
    // For native reasoning providers (Anthropic, OpenAI), reasoning comes through the stream directly
    extractReasoningMiddleware({ tagName: 'think' }),
    loggingMiddleware(),
  ]
}

// ============================================================================
// Generate Functions
// ============================================================================

export async function generateStructured<T extends z.ZodType>(
  options: GenerateObjectOptions<T>,
  serviceId: string,
): Promise<z.infer<T>> {
  const { presetId, schema, system, prompt, signal } = options
  const config = resolveConfig(presetId, serviceId)
  const { preset, providerType, model, providerOptions, supportsStructuredOutput } = config

  log('generateStructured', {
    presetId,
    model: preset.model,
    providerType,
    supportsStructuredOutput,
  })

  const result = await generateText({
    model: wrapLanguageModel({
      model,
      middleware: buildStructuredMiddleware(supportsStructuredOutput),
    }),
    system,
    prompt,
    output: Output.object({ schema }),
    temperature: preset.temperature,
    maxOutputTokens: preset.maxTokens,
    providerOptions,
    abortSignal: signal,
  })

  return result.output as z.infer<T>
}

export async function generatePlainText(
  options: BaseGenerateOptions,
  serviceId: string,
): Promise<string> {
  const { presetId, system, prompt, signal } = options
  const { preset, providerType, model, providerOptions } = resolveConfig(presetId, serviceId)

  log('generatePlainText', { presetId, model: preset.model, providerType })

  const { text } = await generateText({
    model: wrapLanguageModel({ model, middleware: buildPlainTextMiddleware() }),
    system,
    prompt,
    temperature: preset.temperature,
    maxOutputTokens: preset.maxTokens,
    providerOptions,
    abortSignal: signal,
  })

  return text
}

export function streamPlainText(options: BaseGenerateOptions, serviceId: string) {
  const debugId = crypto.randomUUID()
  const { presetId, system, prompt, signal } = options
  const { preset, providerType, model, providerOptions } = resolveConfig(
    presetId,
    serviceId,
    debugId,
  )

  log('streamPlainText', { presetId, model: preset.model, providerType })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({ model, middleware: buildPlainTextMiddleware() }),
    system,
    prompt,
    temperature: preset.temperature,
    maxOutputTokens: preset.maxTokens,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      ui.addDebugResponse(
        debugId,
        serviceId,
        {
          result: result.content,
        },
        startTime,
      )
    },
  })
}

export function streamStructured<T extends z.ZodType>(
  options: GenerateObjectOptions<T>,
  serviceId: string,
) {
  const { presetId, schema, system, prompt, signal } = options
  const debugId = crypto.randomUUID()
  const config = resolveConfig(presetId, serviceId, debugId)
  const { preset, providerType, model, providerOptions, supportsStructuredOutput } = config

  log('streamStructured', { presetId, model: preset.model, providerType, supportsStructuredOutput })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({
      model,
      middleware: buildStructuredMiddleware(supportsStructuredOutput),
    }),
    system,
    prompt,
    output: Output.object({ schema }),
    temperature: preset.temperature,
    maxOutputTokens: preset.maxTokens,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      ui.addDebugResponse(
        debugId,
        serviceId,
        {
          result: result.content,
        },
        startTime,
      )
    },
  })
}

// ============================================================================
// Narrative Generation (Main Profile)
// ============================================================================

interface NarrativeGenerateOptions {
  system: string
  prompt: string
  signal?: AbortSignal
}

export function streamNarrative(options: NarrativeGenerateOptions) {
  const { system, prompt, signal } = options
  const debugId = crypto.randomUUID()
  const { providerType, model, temperature, maxTokens, providerOptions } =
    resolveNarrativeConfig(debugId)

  log('streamNarrative', { model: settings.apiSettings.defaultModel, providerType })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({ model, middleware: buildNarrativeMiddleware() }),
    system,
    prompt,
    temperature,
    maxOutputTokens: maxTokens,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      ui.addDebugResponse(
        debugId,
        'narrative',
        {
          result: result.content,
        },
        startTime,
      )
      console.log('Narrative generation finished', result)
    },
  })
}

export async function generateNarrative(options: NarrativeGenerateOptions): Promise<string> {
  const { system, prompt, signal } = options
  const { providerType, model, temperature, maxTokens, providerOptions } = resolveNarrativeConfig()

  log('generateNarrative', { model: settings.apiSettings.defaultModel, providerType })

  const { text } = await generateText({
    model: wrapLanguageModel({ model, middleware: buildPlainTextMiddleware() }),
    system,
    prompt,
    temperature,
    maxOutputTokens: maxTokens,
    providerOptions,
    abortSignal: signal,
  })

  return text
}
