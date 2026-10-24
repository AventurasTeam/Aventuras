import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'

import type { ProviderInstance } from '../db'
import type { ResolveTarget } from './agents'
import { anthropicCacheMarkerMiddleware } from './cache-marker'
import { getModel } from './model'
import {
  jsonResponseFormatMiddleware,
  promptSchemaMiddleware,
  type JsonSchema,
} from './prompt-schema'
import {
  resolveModel,
  type ResolveFailureKind,
  type ResolveModelConfig,
  type ResolvedParams,
} from './resolve-model'
import { callWithRetry, type CallRetryError } from './transport/call-with-retry'
import { runProviderCall, streamProviderCall } from './transport/provider-call'

export type CallSettings = {
  temperature?: number
  maxOutputTokens?: number
  timeout?: { totalMs: number }
  providerOptions?: {
    anthropic: { thinking: { type: 'enabled'; budgetTokens: number } | { type: 'disabled' } }
  }
}

// setTimeout's largest delay; a longer one fires at once.
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** A profile `timeout` (seconds) in ms; `undefined` when unset, non-finite or ≤ 0. */
export function profileTimeoutMs(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(seconds * 1000, MAX_TIMER_DELAY_MS)
}

// Single owner of the ResolvedParams → SDK call-settings mapping. Thinking is
// anthropic-only: other provider types would reject the providerOptions key.
export function buildCallSettings(
  params: ResolvedParams,
  providerType: ProviderInstance['type'] | undefined,
): CallSettings {
  const timeoutMs = profileTimeoutMs(params.timeout)
  return {
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    ...(params.maxOutput !== undefined ? { maxOutputTokens: params.maxOutput } : {}),
    ...(params.thinking !== undefined && providerType === 'anthropic'
      ? {
          providerOptions: {
            anthropic: {
              thinking:
                params.thinking > 0
                  ? { type: 'enabled' as const, budgetTokens: params.thinking }
                  : { type: 'disabled' as const },
            },
          },
        }
      : {}),
    ...(timeoutMs !== undefined ? { timeout: { totalMs: timeoutMs } } : {}),
  }
}

export type PreparedGeneration =
  | {
      ok: true
      model: LanguageModel
      callSettings: CallSettings
      providerId: string
      modelId: string
      params: ResolvedParams
      providerType: ProviderInstance['type']
    }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

// Resolve an agent target's configuration into a ready-to-call model + settings.
export function prepareGeneration(
  target: ResolveTarget,
  config: ResolveModelConfig,
  actionId?: string,
): PreparedGeneration {
  const resolved = resolveModel(target, config)
  if (!resolved.ok) return resolved
  return {
    ok: true,
    model: getModel(resolved.providerId, resolved.modelId, actionId),
    callSettings: buildCallSettings(resolved.params, resolved.providerType),
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    params: resolved.params,
    providerType: resolved.providerType,
  }
}

// Anthropic caches only at an explicit breakpoint; OpenAI-compatible servers generally reuse
// the longest matching token prefix on their own. `stub` gets none, as it gets no thinking.
function marksSystemPrefix(
  cacheSystemPrefix: boolean | undefined,
  providerType: ProviderInstance['type'],
): boolean {
  return cacheSystemPrefix === true && providerType === 'anthropic'
}

// The cast is safe: getModel returns provider instances, never LanguageModel's string arm.
function withMiddleware(
  model: LanguageModel,
  middleware: LanguageModelMiddleware[],
): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware,
  })
}

/**
 * A rendered template's two halves. A blank system half is left out of the request; a structured
 * call's JSON contract may still create a system message.
 */
export type PromptHalves = { readonly system: string; readonly user: string }

// Providers reject an empty system message.
function promptParams(prompt: PromptHalves): { system?: string; prompt: string } {
  return {
    ...(prompt.system.trim() !== '' ? { system: prompt.system } : {}),
    prompt: prompt.user,
  }
}

export type StreamTextOptions = {
  prompt: PromptHalves
  config: ResolveModelConfig
  abortSignal?: AbortSignal
  actionId?: string
  onError?: (event: { error: unknown }) => void
  /** Mark the system prefix for caching; honoured on `anthropic` providers only. */
  cacheSystemPrefix?: boolean
}

export type StreamTextResult =
  | { ok: true; stream: ReturnType<typeof streamProviderCall>; modelId: string; providerId: string }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

/**
 * Resolve `target`'s model and stream a text generation for `prompt`. The
 * streaming counterpart to `generateStructured`; shares the SDK function's
 * name deliberately — this is the app-side facade over it.
 */
export function streamText(target: ResolveTarget, opts: StreamTextOptions): StreamTextResult {
  const resolved = prepareGeneration(target, opts.config, opts.actionId)
  if (!resolved.ok) return resolved
  const stream = streamProviderCall({
    model: marksSystemPrefix(opts.cacheSystemPrefix, resolved.providerType)
      ? withMiddleware(resolved.model, [anthropicCacheMarkerMiddleware()])
      : resolved.model,
    ...promptParams(opts.prompt),
    ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    ...resolved.callSettings,
  })
  return { ok: true, stream, modelId: resolved.modelId, providerId: resolved.providerId }
}

/** Parse a model's raw text into `schema`, recovering common LLM JSON slop (fences, trailing commas) via jsonrepair before validating. */
export function parseStructured<T>(raw: string, schema: z.ZodType<T>): T {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    obj = JSON.parse(jsonrepair(raw))
  }
  return schema.parse(obj)
}

export type StructuredCallOptions = {
  /** Mark the system prefix for caching; honoured on `anthropic` providers only. */
  cacheSystemPrefix?: boolean
}

/** generation-pipeline.md → Two retry tiers: `recoverable` holds each retried attempt. */
export type GenerateStructuredResult<T> =
  | { status: 'ok'; value: T; recoverable: readonly CallRetryError[] }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'failed'; detail: string; recoverable: readonly CallRetryError[] }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

function describeCallRetryError(error: CallRetryError): string {
  return error.tier === 'provider' ? (error.detail ?? error.reason) : error.detail
}

/**
 * Resolve `target`'s model, call it with `prompt`, and parse the reply against
 * `schema` (retrying provider + parse failures). A generic structured-output
 * generation primitive: the caller supplies the agent target and the Zod schema.
 */
export async function generateStructured<T>(
  target: ResolveTarget,
  prompt: PromptHalves,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  signal: AbortSignal,
  options?: StructuredCallOptions,
): Promise<GenerateStructuredResult<T>> {
  const resolved = prepareGeneration(target, config)
  if (!resolved.ok) return { status: 'not-configured', kind: resolved.kind }

  // z.toJSONSchema throws on unrepresentable schemas (transforms, refinements);
  // surface it as a typed failure rather than a raw rejection past the caller's
  // runAction wrapper.
  let jsonSchema: JsonSchema
  try {
    jsonSchema = z.toJSONSchema(schema) as JsonSchema
  } catch (err) {
    return {
      status: 'failed',
      detail: err instanceof Error ? err.message : String(err),
      recoverable: [],
    }
  }
  // 'auto' injects the schema via the prompt (no capability signal yet); native responseFormat
  // is opt-in via 'force-on'. The marker goes last: on a blank system half, the contract's
  // system message exists only once promptSchemaMiddleware has run.
  const model = withMiddleware(resolved.model, [
    jsonResponseFormatMiddleware(jsonSchema),
    ...(resolved.params.structuredOutput === 'force-on' ? [] : [promptSchemaMiddleware()]),
    ...(marksSystemPrefix(options?.cacheSystemPrefix, resolved.providerType)
      ? [anthropicCacheMarkerMiddleware()]
      : []),
  ])

  const result = await callWithRetry<T>(
    async (sig) =>
      (
        await runProviderCall({
          model,
          ...promptParams(prompt),
          abortSignal: sig,
          ...resolved.callSettings,
        })
      ).text,
    (raw) => parseStructured(raw, schema),
    { maxProviderAttempts: 2, maxParseAttempts: 2, signal },
  )

  const { recoverable } = result
  if (result.status === 'ok') return { status: 'ok', value: result.result, recoverable }
  if (result.status === 'aborted') return { status: 'aborted', recoverable }
  return { status: 'failed', detail: describeCallRetryError(result.error), recoverable }
}
