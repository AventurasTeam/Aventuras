/**
 * Unified Generate Functions
 *
 * Central module for all AI generation operations using the Vercel AI SDK.
 * Uses explicit provider selection from APIProfile.providerType.
 */

import { createLogger } from '$lib/log'
import { debug } from '$lib/stores/debug.svelte'

import { settings } from '$lib/stores/settings.svelte'
import type { APIProfile, GenerationPreset, ProviderType, ReasoningEffort } from '$lib/types'
import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'
import {
  extractJsonMiddleware,
  extractReasoningMiddleware,
  generateText,
  Output,
  streamText,
  wrapLanguageModel,
} from 'ai'
import { jsonrepair } from 'jsonrepair'
import * as z from 'zod'
import { loggingMiddleware, patchResponseMiddleware, promptSchemaMiddleware } from './middleware'
import { retryOn429Middleware } from './middleware/retryMiddleware'
import { createModelFromProfile } from './providers'
import { usesThinkTag } from './providers/config'
import {
  buildProviderOptions,
  resolvePresetModel,
  thinkingNudgeApplies,
  type ResolvedPreset,
} from './presetResolution'

const log = createLogger('Generate')

/** Shared middleware instance for extracting reasoning from <think> tags */
const thinkTagMiddleware = extractReasoningMiddleware({ tagName: 'think' })

// ============================================================================
// Types
// ============================================================================

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
// Config Resolution
// ============================================================================

type ResolvedConfig = ResolvedPreset

interface NarrativeConfig {
  profile: APIProfile
  providerType: ProviderType
  model: LanguageModelV4
  temperature: number
  maxTokens: number
  providerOptions?: SharedV4ProviderOptions
  reasoning: ReasoningEffort
  useThinkTag: boolean
}

function resolveConfig(presetId: string, serviceId: string, debugId?: string): ResolvedConfig {
  return resolvePresetModel({ presetId, serviceId, debugId })
}

/**
 * The narrator has no preset row of its own -- its model, temperature and effort live in
 * `apiSettings` -- so it builds a preset-shaped value and resolves the rest the same way.
 */
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

  const reasoningEffort = settings.apiSettings.reasoningEffort

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

  return {
    profile,
    providerType: profile.providerType,
    model,
    temperature: settings.apiSettings.temperature,
    maxTokens: settings.apiSettings.maxTokens,
    providerOptions: buildProviderOptions(narrativePreset, profile.providerType),
    reasoning: reasoningEffort,
    useThinkTag: usesThinkTag(profile.providerType),
  }
}

// ============================================================================
// Middleware
// ============================================================================

function createJsonExtractMiddleware(): LanguageModelMiddleware {
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

/**
 * Takes the resolved config rather than a row of booleans: every flag it needs is already on
 * it, and four positional `boolean`s in a row is a swap no type error would ever catch.
 */
function buildStructuredMiddleware(config: ResolvedConfig): LanguageModelMiddleware[] {
  const { supportsStructuredOutput, useThinkTag, preset, providerType } = config

  // retryOn429Middleware is intentionally outermost: it re-invokes the whole
  // inner chain (including patchResponseMiddleware) on each retry. Do not
  // reorder without understanding this — putting retry after patchResponse
  // would cause patched state to leak across attempts.
  const base: LanguageModelMiddleware[] = [retryOn429Middleware, patchResponseMiddleware()]

  // Unconditional on purpose: a provider that claims native structured output and then wraps
  // the object in prose is common enough that `structuredOutputOverride: 'off'` exists for it.
  // On a well-behaved response the repair is a no-op.
  base.push(createJsonExtractMiddleware())

  if (useThinkTag) {
    base.push(thinkTagMiddleware)
  }
  if (!supportsStructuredOutput) {
    const nudge =
      !!preset.thinkingNudgePrompt &&
      thinkingNudgeApplies({
        providerType,
        reasoningEffort: preset.reasoningEffort,
        supportsStructuredOutput,
      })
    if (nudge) {
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

function buildPlainTextMiddleware(useThinkTag: boolean): LanguageModelMiddleware[] {
  // retryOn429Middleware is intentionally outermost: it re-invokes the whole
  // inner chain (including patchResponseMiddleware) on each retry. Do not
  // reorder without understanding this — putting retry after patchResponse
  // would cause patched state to leak across attempts.
  const base: LanguageModelMiddleware[] = [retryOn429Middleware, patchResponseMiddleware()]
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
  const { preset, providerType, model, providerOptions, reasoning, supportsStructuredOutput } =
    config

  log('generateStructured', {
    presetId,
    model: preset.model,
    providerType,
    supportsStructuredOutput,
  })

  const result = await generateText({
    model: wrapLanguageModel({
      model: model as LanguageModelV4,
      middleware: buildStructuredMiddleware(config),
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
  const { preset, providerType, model, providerOptions, reasoning, supportsStructuredOutput } =
    config

  log('streamStructured', { presetId, model: preset.model, providerType, supportsStructuredOutput })
  const startTime = Date.now()

  return streamText({
    model: wrapLanguageModel({
      model,
      middleware: buildStructuredMiddleware(config),
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
  const { providerType, model, temperature, maxTokens, providerOptions, reasoning, useThinkTag } =
    resolveNarrativeConfig()

  log('generateNarrative', { model: settings.apiSettings.defaultModel, providerType })

  const { text } = await generateText({
    model: wrapLanguageModel({
      model,
      middleware: buildPlainTextMiddleware(useThinkTag),
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
