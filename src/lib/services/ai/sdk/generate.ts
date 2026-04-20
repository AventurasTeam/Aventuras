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
import type {
  ProviderType,
  GenerationPreset,
  ReasoningEffort,
  APIProfile,
  TextModel,
} from '$lib/types'
import { createLogger } from '$lib/log'
import { createModelFromProfile } from './providers'
import { PROVIDERS, getReasoningExtraction, GOOGLE_SAFETY_SETTINGS } from './providers/config'
import { promptSchemaMiddleware, patchResponseMiddleware, loggingMiddleware } from './middleware'
import { debug } from '$lib/stores/debug.svelte'
import type { OpenAICompatibleProviderOptions } from '@ai-sdk/openai-compatible'
import type { DeepSeekChatOptions } from '@ai-sdk/deepseek'
import type { XaiProviderOptions } from '@ai-sdk/xai'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import type { OpenRouterProviderOptions } from '@openrouter/ai-sdk-provider'
import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'
import type { PollinationsLanguageModelSettings } from 'ai-sdk-pollinations'
import type { GroqProviderOptions } from '@ai-sdk/groq'
import type { MistralLanguageModelOptions } from '@ai-sdk/mistral'

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

const REASONING_TOKEN_BUDGETS: Record<ReasoningEffort, number> = {
  off: 0,
  low: 4000,
  medium: 8000,
  high: 16000,
}

/** Shared middleware instance for extracting reasoning from <think> tags */
const thinkTagMiddleware = extractReasoningMiddleware({ tagName: 'think' })

/**
 * Build provider-specific options from preset settings.
 */
export function buildProviderOptions(
  preset: GenerationPreset,
  providerType: ProviderType,
  structuredOutputs?: boolean,
  modelInfo?: TextModel,
): ProviderOptions | undefined {
  let options: JSONObject = {}

  const budgetTokens = REASONING_TOKEN_BUDGETS[preset.reasoningEffort] ?? 8000
  const reasoningEffort = preset.reasoningEffort === 'off' ? undefined : preset.reasoningEffort

  if (!settings.advancedRequestSettings.manualMode) {
    switch (providerType) {
      case 'openrouter':
        // OpenRouter uses max_tokens for reasoning budget
        if (reasoningEffort) {
          options = { reasoning: { effort: reasoningEffort } } satisfies OpenRouterProviderOptions
        }
        break
      case 'openai':
        if (reasoningEffort) {
          options = { reasoningEffort: reasoningEffort } satisfies OpenAIResponsesProviderOptions
        }
        break
      case 'anthropic':
        if (reasoningEffort) {
          options = {
            thinking: {
              type: 'enabled',
              budgetTokens,
            },
          } satisfies AnthropicProviderOptions
        }
        break
      case 'xai':
        if (reasoningEffort) {
          // xAI Chat API supports 'low' | 'high' only (no 'medium')
          options = {
            reasoningEffort: reasoningEffort === 'medium' ? 'high' : reasoningEffort,
          } satisfies XaiProviderOptions
        }
        options = { ...options, parallel_function_calling: true } satisfies XaiProviderOptions
        break
      case 'deepseek':
        // DeepSeek uses binary thinking: enabled/disabled (no effort levels)
        if (reasoningEffort) {
          options = { thinking: { type: 'enabled' } } satisfies DeepSeekChatOptions
        }
        break
      case 'google': {
        // Reinject safety settings here for complete model-request coverage
        options = {
          safetySettings: GOOGLE_SAFETY_SETTINGS,
        } satisfies GoogleGenerativeAIProviderOptions
        // Gemini 2.5 uses thinkingBudget; Gemma 4 uses minimal/high; Gemini 3.x uses low/medium/high
        const usesBudget = modelInfo?.isBudgetReasoning ?? preset.model.includes('gemini-2.5')
        if (usesBudget) {
          // Always send thinkingConfig for Gemini 2.5: 0=disabled, -1=unlimited, otherwise token count
          const gemini25Budgets: Record<ReasoningEffort, number> = {
            off: 0,
            low: 2048,
            medium: -1,
            high: 8196,
          }
          options = {
            ...options,
            thinkingConfig: {
              includeThoughts: true,
              thinkingBudget: gemini25Budgets[preset.reasoningEffort],
            },
          } satisfies GoogleGenerativeAIProviderOptions
        } else if (reasoningEffort) {
          const isGemma = preset.model.toLowerCase().includes('gemma')
          const thinkingLevel = isGemma
            ? reasoningEffort === 'high'
              ? 'high'
              : 'minimal'
            : reasoningEffort
          options = {
            ...options,
            thinkingConfig: {
              includeThoughts: true,
              thinkingLevel,
            },
          } satisfies GoogleGenerativeAIProviderOptions
        }
        if (structuredOutputs) {
          options = { ...options, structuredOutputs } satisfies GoogleGenerativeAIProviderOptions
        }
        break
      }
      case 'pollinations':
        options = {
          reasoning_effort: reasoningEffort,
          parallel_tool_calls: true,
        } satisfies PollinationsLanguageModelSettings
        break
      case 'groq':
        options = {
          reasoningEffort: reasoningEffort,
          structuredOutputs,
          parallelToolCalls: true,
        } satisfies GroqProviderOptions
        break
      case 'zhipu':
        if (reasoningEffort) {
          options = { type: 'enabled', clearThinking: true, doSample: true }
        }
        break
      case 'mistral':
        options = {
          safePrompt: false,
          parallelToolCalls: true,
          structuredOutputs,
        } satisfies MistralLanguageModelOptions
        break
      case 'chutes':
      case 'nvidia-nim':
      case 'nanogpt':
      case 'ollama':
      case 'lmstudio':
      case 'llamacpp':
      case 'openai-compatible':
        options = { reasoningEffort: reasoningEffort } satisfies OpenAICompatibleProviderOptions
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
  useThinkTag: boolean
}

function resolveConfig(presetId: string, serviceId: string, debugId?: string): ResolvedConfig {
  const preset = settings.getPresetConfig(presetId, serviceId)
  const profileId = preset.profileId ?? settings.apiSettings.mainNarrativeProfileId
  const profile = settings.getProfile(profileId)

  if (!profile) {
    throw new Error(`Profile not found: ${profileId}`)
  }

  const capabilities = PROVIDERS[profile.providerType].capabilities

  const override = preset.structuredOutputOverride
  let supportsStructuredOutput: boolean
  if (override === 'on') {
    supportsStructuredOutput = true
  } else if (override === 'off') {
    supportsStructuredOutput = false
  } else {
    // Auto: start with provider-level default, then refine with fetched model data if available
    const providerDefault = capabilities?.structuredOutput ?? true
    if (capabilities?.modelCapabilityFetching) {
      const fetchedModel = settings.getProfileModels(profileId).find((m) => m.id === preset.model)
      supportsStructuredOutput = !!fetchedModel?.structuredOutput
    } else {
      supportsStructuredOutput = providerDefault
    }
  }

  const fetchedModel = settings.getProfileModels(profileId).find((m) => m.id === preset.model)

  const model = createModelFromProfile({
    profile,
    modelId: preset.model,
    presetId: serviceId,
    debugId,
    structuredOutputs: supportsStructuredOutput,
    manualBody: preset.manualBody ?? '',
  })

  const useThinkTag =
    profile.providerType === 'openai-compatible' ||
    getReasoningExtraction(profile.providerType) === 'think-tag'

  return {
    preset,
    profile,
    providerType: profile.providerType,
    model,
    providerOptions: buildProviderOptions(
      preset,
      profile.providerType,
      supportsStructuredOutput,
      fetchedModel,
    ),
    supportsStructuredOutput,
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
  const fetchedModel = settings.getProfileModels(profile.id).find((m) => m.id === baseModelId)

  const model = createModelFromProfile({
    profile,
    modelId: baseModelId,
    presetId: 'narrative',
    debugId,
    manualBody: settings.apiSettings.manualBody ?? '',
  })

  const reasoningEffort = settings.apiSettings.reasoningEffort ?? 'off'
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
    providerOptions: buildProviderOptions(
      narrativePreset,
      profile.providerType,
      false,
      fetchedModel,
    ),
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
  const base: LanguageModelV3Middleware[] = [patchResponseMiddleware()]

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
  const base: LanguageModelV3Middleware[] = [patchResponseMiddleware()]
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
  const { preset, providerType, model, providerOptions, supportsStructuredOutput, useThinkTag } =
    config

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
  const { preset, providerType, model, providerOptions, useThinkTag } = resolveConfig(
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
    providerOptions,
    abortSignal: signal,
  })

  return text
}

export function streamPlainText(options: BaseGenerateOptions, serviceId: string) {
  const debugId = crypto.randomUUID()
  const { presetId, system, prompt, signal } = options
  const { preset, providerType, model, providerOptions, useThinkTag } = resolveConfig(
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
  const { preset, providerType, model, providerOptions, supportsStructuredOutput, useThinkTag } =
    config

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
  const { providerType, model, temperature, maxTokens, providerOptions, useThinkTag } =
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
  const { providerType, model, temperature, maxTokens, providerOptions } = resolveNarrativeConfig()

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
    providerOptions,
    abortSignal: signal,
  })

  return text
}
