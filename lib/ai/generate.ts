import {
  wrapLanguageModel,
  type FinishReason,
  type LanguageModel,
  type LanguageModelMiddleware,
  type LanguageModelUsage,
} from 'ai'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'

import { boundedSignal } from '@/lib/abort'
import { logger } from '@/lib/diagnostics'

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
  describeReplyCutOff,
  isCutOff,
  ReplyCutOffError,
  replyCutOff,
  type ReplyCutOffFailure,
} from './reply-cut-off'
import {
  resolveModel,
  type ResolveFailureKind,
  type ResolveModelConfig,
  type ResolvedParams,
} from './resolve-model'
import { callWithRetry, type CallRetryError } from './transport/call-with-retry'
import { ProviderTimeoutError } from './transport/classify-provider-error'
import { runProviderCall, streamProviderCall } from './transport/provider-call'

export type CallSettings = {
  temperature?: number
  maxOutputTokens?: number
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

// Sole ResolvedParams → call-settings mapping. Thinking is anthropic-only: other providers reject
// the providerOptions key. No `timeout`: the SDK builds AbortSignal.timeout, which RN lacks.
export function buildCallSettings(
  params: ResolvedParams,
  providerType: ProviderInstance['type'] | undefined,
): CallSettings {
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
  }
}

export type PreparedGeneration =
  | {
      ok: true
      model: LanguageModel
      callSettings: CallSettings
      /** Profile `timeout` in ms, enforced on the call's own signal, not the SDK's `timeout`. */
      timeoutMs: number | undefined
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
    timeoutMs: profileTimeoutMs(resolved.params.timeout),
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
  | {
      ok: true
      stream: ReturnType<typeof streamProviderCall>
      modelId: string
      providerId: string
      /** The profile's `timeout` ended the stream, which then closes as if cancelled. */
      timedOut: () => boolean
      /** The bound `timedOut` reports on, in ms; `undefined` when the profile sets none. */
      timeoutMs: number | undefined
      /** The profile's max output (ResolvedParams.maxOutput); undefined when unset. */
      maxOutput: number | undefined
    }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

/**
 * Resolve `target`'s model and stream a text generation for `prompt`. The
 * streaming counterpart to `generateStructured`; shares the SDK function's
 * name deliberately — this is the app-side facade over it.
 */
export function streamText(target: ResolveTarget, opts: StreamTextOptions): StreamTextResult {
  const resolved = prepareGeneration(target, opts.config, opts.actionId)
  if (!resolved.ok) return resolved
  const bounded =
    resolved.timeoutMs === undefined ? null : boundedSignal(opts.abortSignal, resolved.timeoutMs)
  const abortSignal = bounded?.signal ?? opts.abortSignal
  const stream = streamProviderCall({
    model: marksSystemPrefix(opts.cacheSystemPrefix, resolved.providerType)
      ? withMiddleware(resolved.model, [anthropicCacheMarkerMiddleware()])
      : resolved.model,
    ...promptParams(opts.prompt),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    // Not on an error: the SDK reports each error part and reads on, so a stall can follow. After a
    // fatal one the stream is over, and the timer lapses on a call nothing awaits.
    ...(bounded === null
      ? {}
      : { onFinish: () => bounded.dispose(), onAbort: () => bounded.dispose() }),
    ...resolved.callSettings,
  })
  return {
    ok: true,
    stream,
    modelId: resolved.modelId,
    providerId: resolved.providerId,
    timedOut: () => bounded?.expired() ?? false,
    timeoutMs: resolved.timeoutMs,
    maxOutput: resolved.params.maxOutput,
  }
}

/**
 * Parse a model's raw text into `schema`, recovering common LLM JSON slop (fences, trailing commas)
 * via jsonrepair before validating. `repair: false` accepts only a strict document.
 */
export function parseStructured<T>(
  raw: string,
  schema: z.ZodType<T>,
  opts: { repair?: boolean } = {},
): T {
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch (error) {
    if (opts.repair === false) throw error
    obj = JSON.parse(jsonrepair(raw))
  }
  return schema.parse(obj)
}

export type StructuredCallOptions = {
  /** Mark the system prefix for caching; honoured on `anthropic` providers only. */
  cacheSystemPrefix?: boolean
  /** The run's action, linking the call's fetch capture (observability.md → actionId threading);
   *  `null` outside a run, as for the wizard. Required so no call compiles without one. */
  actionId: string | null
}

// A reply without them (a fake returning only text) reads as finished, with no counts.
type StructuredReply = {
  text: string
  finishReason: FinishReason | undefined
  usage: LanguageModelUsage | undefined
}

/** generation-pipeline.md → Two retry tiers: `recoverable` holds each retried attempt. */
export type GenerateStructuredResult<T> =
  | { status: 'ok'; value: T; recoverable: readonly CallRetryError[] }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'failed'; error: CallRetryError; recoverable: readonly CallRetryError[] }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

/** A failure as one line, for logs and failure details. */
export function describeCallRetryError(error: CallRetryError): string {
  switch (error.tier) {
    case 'provider':
      return error.detail ?? error.reason
    case 'parse':
      return error.detail
    case 'reply-cut-off':
      return describeReplyCutOff(error)
  }
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
  options: StructuredCallOptions,
): Promise<GenerateStructuredResult<T>> {
  const resolved = prepareGeneration(target, config, options.actionId ?? undefined)
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
      error: {
        tier: 'parse',
        detail: err instanceof Error ? err.message : String(err),
        attempt: 0,
      },
      recoverable: [],
    }
  }
  // 'auto' injects the schema via the prompt (no capability signal yet); native responseFormat
  // is opt-in via 'force-on'. The marker goes last: on a blank system half, the contract's
  // system message exists only once promptSchemaMiddleware has run.
  const model = withMiddleware(resolved.model, [
    jsonResponseFormatMiddleware(jsonSchema),
    ...(resolved.params.structuredOutput === 'force-on' ? [] : [promptSchemaMiddleware()]),
    ...(marksSystemPrefix(options.cacheSystemPrefix, resolved.providerType)
      ? [anthropicCacheMarkerMiddleware()]
      : []),
  ])

  const logCutOff = (
    failure: ReplyCutOffFailure,
    outcome: { outcome: 'accepted' } | { outcome: 'refused'; parseError: string },
  ): void => {
    logger.warn(
      'provider.reply_cut_off',
      { ...outcome, target, ...failure },
      options.actionId === null ? undefined : { actionId: options.actionId },
    )
  }
  // generation-pipeline.md → Cut-off replies: a cut reply is accepted only as a strict document,
  // since jsonrepair would close a truncated one into a valid but shorter reply.
  const parse = (reply: StructuredReply): T => {
    if (!isCutOff(reply.finishReason)) return parseStructured(reply.text, schema)
    const failure = replyCutOff({
      usage: reply.usage,
      maxOutput: resolved.params.maxOutput,
      window: null,
      promptEstimate: null,
      providerId: resolved.providerId,
      modelId: resolved.modelId,
    })
    let value: T
    try {
      value = parseStructured(reply.text, schema, { repair: false })
    } catch (error) {
      // The message tells a truncation (a syntax error) from a document of the wrong shape.
      logCutOff(failure, {
        outcome: 'refused',
        parseError: error instanceof Error ? error.message : String(error),
      })
      throw new ReplyCutOffError(failure)
    }
    logCutOff(failure, { outcome: 'accepted' })
    return value
  }

  const { timeoutMs } = resolved
  const result = await callWithRetry<T, StructuredReply>(
    async (sig) => {
      // Per attempt, so a retry gets the whole bound again.
      const bounded = timeoutMs === undefined ? null : boundedSignal(sig, timeoutMs)
      try {
        const call = await runProviderCall({
          model,
          ...promptParams(prompt),
          abortSignal: bounded?.signal ?? sig,
          ...resolved.callSettings,
        })
        return { text: call.text, finishReason: call.finishReason, usage: call.usage }
      } catch (error) {
        if (bounded?.expired()) throw new ProviderTimeoutError()
        throw error
      } finally {
        bounded?.dispose()
      }
    },
    parse,
    { maxProviderAttempts: 2, maxParseAttempts: 2, signal },
  )

  const { recoverable } = result
  if (result.status === 'ok') return { status: 'ok', value: result.result, recoverable }
  if (result.status === 'aborted') return { status: 'aborted', recoverable }
  return { status: 'failed', error: result.error, recoverable }
}
