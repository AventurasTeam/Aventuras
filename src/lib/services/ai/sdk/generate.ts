/**
 * Unified Generate Functions
 *
 * Central module for all AI generation operations using the Vercel AI SDK.
 * Uses explicit provider selection from APIProfile.providerType.
 */

import { createLogger } from '$lib/log'
import { debug } from '$lib/stores/debug.svelte'

import { settings } from '$lib/stores/settings.svelte'
import { ToSdkEffort } from '$lib/types'
import type { APIProfile, GenerationPreset, ProviderType, SdkEffort } from '$lib/types'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { GroqProviderOptions } from '@ai-sdk/groq'
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { LanguageModelV3, LanguageModelV3Middleware } from '@ai-sdk/provider'
import type { ProviderOptions } from '@ai-sdk/provider-utils'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import {
  extractJsonMiddleware,
  extractReasoningMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai'
import type { PollinationsLanguageModelSettings } from 'ai-sdk-pollinations'
import { jsonrepair } from 'jsonrepair'
import type { z } from 'zod'
import { loggingMiddleware, patchResponseMiddleware, promptSchemaMiddleware } from './middleware'
import { retryOn429Middleware } from './middleware/retryMiddleware'
import { createModelFromProfile } from './providers'
import { getReasoningExtraction, GOOGLE_SAFETY_SETTINGS, PROVIDERS } from './providers/config'

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
  'nvidia-nim': 'nvidia-nim',
  'openai-compatible': 'openaiCompatible',
  openai: 'openai',
  anthropic: 'anthropic',
  google: 'google',
  xai: 'xai',
  groq: 'groq',
  zhipu: 'zhipu',
  deepseek: 'deepseek',
  mistral: 'mistral',
}

/** Shared middleware instance for extracting reasoning from <think> tags */
const thinkTagMiddleware = extractReasoningMiddleware({ tagName: 'think' })

/**
 * Build provider-specific options from preset settings.
 */
export function buildProviderOptions(
  preset: GenerationPreset,
  providerType: ProviderType,
): ProviderOptions | undefined {
  let options: JSONObject = {}

  const reasoning = preset.reasoningEffort === 'off' ? 'none' : preset.reasoningEffort

  if (!settings.advancedRequestSettings.manualMode) {
    switch (providerType) {
      case 'openai':
        if (reasoning !== 'none') {
          options = {
            reasoningSummary: 'auto',
          } satisfies OpenAIResponsesProviderOptions
        }
        break
      case 'anthropic':
        // all 4.6+ models support adaptive thinking
        // everything older than 4.5 has been deprecated and removed from most providers
        if (reasoning !== 'none' && !preset.model.includes('-4-5')) {
          options = {
            thinking: {
              type: 'adaptive',
              display: 'summarized',
            },
            effort: reasoning,
          } satisfies AnthropicProviderOptions
        }
        break
      case 'xai':
        options = { parallel_function_calling: true } satisfies XaiProviderOptions
        break
      case 'google': {
        // Reinject safety settings here for complete model-request coverage
        options = {
          safetySettings: GOOGLE_SAFETY_SETTINGS,
        } satisfies GoogleGenerativeAIProviderOptions
        if (reasoning !== 'none') {
          options = {
            ...options,
            thinkingConfig: { includeThoughts: true },
          } satisfies GoogleGenerativeAIProviderOptions
        }
        break
      }
      case 'nanogpt':
        options = { reasoning_effort: reasoning !== 'max' ? reasoning : 'xhigh' }
        break
      case 'pollinations':
        options = {
          reasoning_effort: reasoning !== 'max' ? reasoning : 'xhigh',
          parallel_tool_calls: true,
        } satisfies PollinationsLanguageModelSettings
        break
      case 'groq':
        options = { parallelToolCalls: true } satisfies GroqProviderOptions
        break
      case 'zhipu':
        if (reasoning !== 'none') {
          options = {
            thinking: { type: 'enabled' },
            reasoning_effort: reasoning,
          }
        } else {
          options = {
            thinking: { type: 'disabled' },
          }
        }
        break
      case 'mistral':
        options = {
          safePrompt: false,
          parallelToolCalls: true,
        } satisfies MistralLanguageModelOptions
        break
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
  reasoning: SdkEffort
  supportsStructuredOutput: boolean
  useThinkTag: boolean
}

interface NarrativeConfig {
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV3
  temperature: number
  maxTokens: number
  providerOptions: ProviderOptions | undefined
  reasoning: SdkEffort
  useThinkTag: boolean
}

function resolveConfig(presetId: string, serviceId: string, debugId?: string): ResolvedConfig {
  const preset = settings.getPresetConfig(presetId, serviceId)
  const profileId = preset.profileId ?? settings.apiSettings.mainNarrativeProfileId
  const profile = settings.getProfile(profileId)

  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  const fetchedModel = settings.getProfileModels(profileId).find((m) => m.id === preset.model)

  let structuredOutputs = false
  switch (preset.structuredOutputOverride) {
    case 'on':
      structuredOutputs = true
      break
    case 'off':
      structuredOutputs = false
      break
    case 'auto':
      const capabilities = PROVIDERS[profile.providerType].capabilities
      structuredOutputs = capabilities?.modelCapabilityFetching
        ? !!fetchedModel?.structuredOutput
        : (capabilities?.structuredOutput ?? true)
      break
  }

  const model = createModelFromProfile({
    profile,
    modelId: preset.model,
    presetId: serviceId,
    debugId,
    structuredOutputs,
    manualBody: preset.manualBody ?? '',
    serviceId,
  })

  const reasoning = ToSdkEffort(preset.reasoningEffort)
  const useThinkTag =
    profile.providerType === 'openai-compatible' ||
    getReasoningExtraction(profile.providerType) === 'think-tag'

  const providerOptions = buildProviderOptions(preset, profile.providerType)

  return {
    preset,
    profile,
    providerType: profile.providerType,
    model,
    providerOptions,
    reasoning,
    supportsStructuredOutput: structuredOutputs,
    useThinkTag,
  }
}

function resolveNarrativeConfig(debugId?: string): NarrativeConfig {
  const profile = settings.getMainNarrativeProfile()

  if (!profile) {
    throw new Error(
      'Main narrative profile not configured. Please set up an API profile in Settings.',
    )
  }

  const baseModelId = settings.apiSettings.defaultModel

  const model = createModelFromProfile({
    profile,
    modelId: baseModelId,
    presetId: 'narrative',
    debugId,
    manualBody: settings.apiSettings.manualBody ?? '',
  })

  const reasoningEffort = ToSdkEffort(settings.apiSettings.reasoningEffort)

  const narrativePreset: GenerationPreset = {
    id: '_narrative',
    name: 'Narrative',
    description: 'Main narrative generation',
    profileId: profile.id,
    model: baseModelId,
    temperature: settings.apiSettings.temperature,
    maxTokens: settings.apiSettings.maxTokens,
    reasoningEffort: reasoningEffort,
    manualBody: settings.apiSettings.manualBody ?? '',
  }

  const useThinkTag =
    profile.providerType === 'openai-compatible' ||
    getReasoningExtraction(profile.providerType) === 'think-tag'

  return {
    profile,
    providerType: profile.providerType,
    model,
    temperature: settings.apiSettings.temperature,
    maxTokens: settings.apiSettings.maxTokens,
    providerOptions: buildProviderOptions(narrativePreset, profile.providerType),
    reasoning: reasoningEffort === 'off' ? 'none' : reasoningEffort,
    useThinkTag,
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

function buildStructuredMiddleware(
  supportsStructuredOutput: boolean,
  useThinkTag: boolean,
  reasoningEnabled: boolean,
  thinkingNudge: boolean,
): LanguageModelV3Middleware[] {
  // retryOn429Middleware is intentionally outermost: it re-invokes the whole
  // inner chain (including patchResponseMiddleware) on each retry. Do not
  // reorder without understanding this — putting retry after patchResponse
  // would cause patched state to leak across attempts.
  const base: LanguageModelV3Middleware[] = [retryOn429Middleware, patchResponseMiddleware()]

  base.push(createJsonExtractMiddleware())

  if (useThinkTag) {
    base.push(thinkTagMiddleware)
  }
  if (!supportsStructuredOutput) {
    if (useThinkTag && reasoningEnabled && thinkingNudge) {
      base.push(
        promptSchemaMiddleware({
          instruction: `Respond with your reasoning inside <think> and </think> tags first. Then, output strictly valid JSON compatible with the TypeScript type Response from the following:\n\n{schema}\n\nOutput ONLY the JSON object after the </think> tag, no other text or markdown.`,
        }),
      )
    } else {
      base.push(promptSchemaMiddleware())
    }
  }

  base.push(loggingMiddleware())
  return base
}

function buildPlainTextMiddleware(useThinkTag: boolean): LanguageModelV3Middleware[] {
  // retryOn429Middleware is intentionally outermost: it re-invokes the whole
  // inner chain (including patchResponseMiddleware) on each retry. Do not
  // reorder without understanding this — putting retry after patchResponse
  // would cause patched state to leak across attempts.
  const base: LanguageModelV3Middleware[] = [retryOn429Middleware, patchResponseMiddleware()]
  if (useThinkTag) {
    base.push(thinkTagMiddleware)
  }
  base.push(loggingMiddleware())
  return base
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
  const {
    preset,
    providerType,
    model,
    providerOptions,
    reasoning,
    supportsStructuredOutput,
    useThinkTag,
  } = config

  log('generateStructured', {
    presetId,
    model: preset.model,
    providerType,
    supportsStructuredOutput,
  })

  const result = await generateText({
    model: wrapLanguageModel({
      model,
      middleware: buildStructuredMiddleware(
        supportsStructuredOutput,
        useThinkTag,
        !!preset.reasoningEffort && preset.reasoningEffort !== 'off',
        !!preset.thinkingNudgePrompt,
      ),
    }),
    system,
    prompt,
    output: Output.object({ schema }),
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
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
  const { preset, providerType, model, providerOptions, reasoning, useThinkTag } = resolveConfig(
    presetId,
    serviceId,
  )

  log('generatePlainText', { presetId, model: preset.model, providerType })

  const { text } = await generateText({
    model: wrapLanguageModel({
      model,
      middleware: buildPlainTextMiddleware(useThinkTag),
    }),
    system,
    prompt,
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
    providerOptions,
    abortSignal: signal,
  })

  return text
}

export function streamPlainText(options: BaseGenerateOptions, serviceId: string) {
  const debugId = crypto.randomUUID()
  const { presetId, system, prompt, signal } = options
  const { preset, providerType, model, providerOptions, reasoning, useThinkTag } = resolveConfig(
    presetId,
    serviceId,
    debugId,
  )

  log('streamPlainText', { presetId, model: preset.model, providerType })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({
      model,
      middleware: buildPlainTextMiddleware(useThinkTag),
    }),
    system,
    prompt,
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      debug.addDebugResponse(
        debugId,
        serviceId + ':result',
        {
          _note: 'This is the final SDK summary. Look at the other log entry for the raw response.',
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
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
  const {
    preset,
    providerType,
    model,
    providerOptions,
    reasoning,
    supportsStructuredOutput,
    useThinkTag,
  } = config

  log('streamStructured', { presetId, model: preset.model, providerType, supportsStructuredOutput })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({
      model,
      middleware: buildStructuredMiddleware(
        supportsStructuredOutput,
        useThinkTag,
        !!preset.reasoningEffort && preset.reasoningEffort !== 'off',
        !!preset.thinkingNudgePrompt,
      ),
    }),
    system,
    prompt,
    output: Output.object({ schema }),
    temperature: !settings.advancedRequestSettings.manualMode ? preset.temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? preset.maxTokens : undefined,
    reasoning,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      debug.addDebugResponse(
        debugId,
        serviceId + ':result',
        {
          _note: 'This is the final SDK summary. Look at the other log entry for the raw response.',
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
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
  const { providerType, model, temperature, maxTokens, providerOptions, reasoning, useThinkTag } =
    resolveNarrativeConfig(debugId)

  log('streamNarrative', { model: settings.apiSettings.defaultModel, providerType })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({
      model,
      middleware: buildPlainTextMiddleware(useThinkTag),
    }),
    system,
    prompt,
    temperature: !settings.advancedRequestSettings.manualMode ? temperature : undefined,
    maxOutputTokens: !settings.advancedRequestSettings.manualMode ? maxTokens : undefined,
    reasoning,
    providerOptions,
    abortSignal: signal,
    onFinish: (result) => {
      debug.addDebugResponse(
        debugId,
        'narrative:result',
        {
          _note: 'This is the final SDK summary. Look at the other log entry for the raw response.',
          finishReason: result.finishReason,
          usage: result.usage,
          providerMetadata: result.providerMetadata,
        },
        startTime,
      )
    },
  })
}

export async function generateNarrative(options: NarrativeGenerateOptions): Promise<string> {
  const { system, prompt, signal } = options
  const { providerType, model, temperature, maxTokens, providerOptions, reasoning } =
    resolveNarrativeConfig()

  log('generateNarrative', { model: settings.apiSettings.defaultModel, providerType })

  const { text } = await generateText({
    model: wrapLanguageModel({
      model,
      middleware: buildPlainTextMiddleware(getReasoningExtraction(providerType) === 'think-tag'),
    }),
    system,
    prompt,
    temperature,
    maxOutputTokens: maxTokens,
    reasoning,
    providerOptions,
    abortSignal: signal,
  })

  return text
}
