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

import type { ModelSettings, PromptSections, ProviderInstance } from '../db'
import type { ResolveTarget } from './agents'
import { anthropicCacheMarkerMiddleware } from './cache-marker'
import {
  ContextWindowError,
  countPromptText,
  describeContextWindow,
  generationWindow,
  primePromptCount,
  windowCheckMiddleware,
  type ContextWindowFailure,
  type GenerationWindow,
} from './context-window'
import { getModel } from './model'
import {
  jsonResponseFormatMiddleware,
  promptContract,
  promptSchemaMiddleware,
  withClosing,
  type JsonSchema,
} from './prompt-schema'
import {
  countSections,
  promptSectionsOf,
  type CountedSections,
  type PromptSectionsInput,
} from './prompt-sections'
import {
  describeReplyCutOff,
  isCutOff,
  ReplyCutOffError,
  replyCutOff,
  type ReplyCutOffFailure,
} from './reply-cut-off'
import { resolveModel, type ResolveFailureKind, type ResolveModelConfig } from './resolve-model'
import { callWithRetry, type CallRetryError } from './transport/call-with-retry'
import {
  capabilityHintOf,
  CARRIED_NOTHING,
  ProviderTimeoutError,
  type CapabilityHint,
  type CarriedCapabilities,
} from './transport/classify-provider-error'
import { runProviderCall, streamProviderCall } from './transport/provider-call'
import { checkInputTokens } from './truncation-check'
import { tokenFiguresOf, type TokenFigures } from './usage-figures'

export type CallSettings = {
  temperature?: number
  maxOutputTokens?: number
  providerOptions?: {
    anthropic: { thinking: { type: 'enabled'; budgetTokens: number } | { type: 'disabled' } }
  }
}

// setTimeout's largest delay; a longer one fires at once.
const MAX_TIMER_DELAY_MS = 2_147_483_647

/** A settings `timeout` (seconds) in ms; `undefined` when unset, non-finite or ≤ 0. */
export function profileTimeoutMs(seconds: number | undefined): number | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.min(seconds * 1000, MAX_TIMER_DELAY_MS)
}

// Sole ModelSettings → call-settings mapping. Thinking is anthropic-only: other providers reject
// the providerOptions key. No `timeout`: the SDK builds AbortSignal.timeout, which RN lacks.
export function buildCallSettings(
  params: ModelSettings,
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
      /** The settings' `timeout` in ms, enforced on the call's own signal, not the SDK's `timeout`. */
      timeoutMs: number | undefined
      providerId: string
      modelId: string
      params: ModelSettings
      /** The settings are the story override's (ResolveModelResult.fromOverride). */
      fromOverride: boolean
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
    fromOverride: resolved.fromOverride,
    providerType: resolved.providerType,
  }
}

// Anthropic caches only at an explicit breakpoint; OpenAI-compatible servers generally reuse
// the longest matching token prefix on their own. `stub` gets none, as it gets no thinking.
export function marksSystemPrefix(
  cacheSystemPrefix: boolean | undefined,
  providerType: ProviderInstance['type'],
): boolean {
  return cacheSystemPrefix === true && providerType === 'anthropic'
}

// The cast is safe: getModel returns provider instances, never LanguageModel's string arm.
export function withMiddleware(
  model: LanguageModel,
  middleware: LanguageModelMiddleware[],
): LanguageModel {
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware,
  })
}

// Must go last in a chain. `estimate()` is the latest count, null until the SDK built a request.
export function windowCheck(
  providers: readonly ProviderInstance[],
  providerId: string,
  modelId: string,
  attribution: { actionId: string } | undefined,
): {
  window: GenerationWindow
  estimate: () => number | null
  middleware: LanguageModelMiddleware
} {
  const window = generationWindow(providers, providerId, modelId)
  let estimate: number | null = null
  const middleware = windowCheckMiddleware({
    window,
    providerId,
    modelId,
    onEstimate: (tokens) => {
      estimate = tokens
    },
    ...attribution,
  })
  return { window, estimate: () => estimate, middleware }
}

// After every middleware that changes the request, so it reads the request as sent; `carried()` is
// the latest request's. The anthropic adapter sends no `thinking` field for a disabled setting.
export function carriedCapabilities(): {
  carried: () => CarriedCapabilities
  middleware: LanguageModelMiddleware
} {
  let carried = CARRIED_NOTHING
  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const thinking = params.providerOptions?.anthropic?.thinking
      carried = {
        reasoning:
          typeof thinking === 'object' &&
          thinking !== null &&
          'type' in thinking &&
          thinking.type === 'enabled',
        structuredOutput: params.responseFormat?.type === 'json',
        toolCalling: (params.tools?.length ?? 0) > 0,
      }
      return params
    },
  }
  return { carried: () => carried, middleware }
}

/**
 * A rendered template's two halves. A blank system half is left out of the request; a structured
 * call's JSON contract may still create a system message.
 */
export type PromptHalves = { readonly system: string; readonly user: string }

// Providers reject an empty system message.
export function promptParams(prompt: PromptHalves): { system?: string; prompt: string } {
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
  /** The prompt by section: counted before the request, its user half primed for the check. */
  sections?: PromptSectionsInput
}

export type StreamTextResult =
  | {
      ok: true
      stream: ReturnType<typeof streamProviderCall>
      modelId: string
      providerId: string
      /** The settings' `timeout` ended the stream, which then closes as if cancelled. */
      timedOut: () => boolean
      /** The bound `timedOut` reports on, in ms; `undefined` when the settings set none. */
      timeoutMs: number | undefined
      /** The settings' max output; undefined when unset. */
      maxOutput: number | undefined
      /** The settings are the story override's, so a failure's copy names it, not the profile. */
      fromOverride: boolean
      /** The model's window as resolved for this call. */
      window: GenerationWindow
      /** The request's token estimate; null until the SDK built the request. */
      promptEstimate: () => number | null
      /** The check's refusal or a recognized overflow, as a context-window failure; else null. */
      contextWindowFailureOf: (error: unknown) => ContextWindowFailure | null
      /** The hint a rejection gives on a capability this call's request carried; else undefined. */
      capabilityHintOf: (error: unknown) => CapabilityHint | undefined
      /** The prompt by section against the latest estimate; null without sections or an estimate. */
      promptSections: () => PromptSections | null
      /** The counts the provider reported, its cache and reasoning figures read from raw usage. */
      tokensOf: (usage: LanguageModelUsage | undefined) => TokenFigures | undefined
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
  const { providerId, modelId, providerType } = resolved
  const attribution = opts.actionId === undefined ? undefined : { actionId: opts.actionId }
  const check = windowCheck(opts.config.providers, providerId, modelId, attribution)
  const sent = carriedCapabilities()
  const counted =
    opts.sections === undefined
      ? null
      : countSections(opts.sections, { providerId, modelId, ...attribution })
  if (counted !== null) primePromptCount(opts.prompt.user, counted.userTokens)
  const bounded =
    resolved.timeoutMs === undefined ? null : boundedSignal(opts.abortSignal, resolved.timeoutMs)
  const abortSignal = bounded?.signal ?? opts.abortSignal
  const stream = streamProviderCall({
    // The check's refusal, thrown before any request, and a recognized overflow reach onError as
    // a ContextWindowError (architecture.md → The pre-send check).
    model: withMiddleware(resolved.model, [
      ...(marksSystemPrefix(opts.cacheSystemPrefix, resolved.providerType)
        ? [anthropicCacheMarkerMiddleware()]
        : []),
      sent.middleware,
      check.middleware,
    ]),
    ...promptParams(opts.prompt),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    // Not disposed on an error: the SDK reports each error part and reads on, so a stall can
    // follow. After a fatal one the timer lapses on a call nothing awaits.
    onFinish: ({ usage }) => {
      bounded?.dispose()
      checkInputTokens({
        usage,
        estimate: check.estimate(),
        providerId,
        modelId,
        providerType,
        ...attribution,
      })
    },
    ...(bounded === null ? {} : { onAbort: () => bounded.dispose() }),
    ...resolved.callSettings,
  })
  return {
    ok: true,
    stream,
    modelId,
    providerId,
    timedOut: () => bounded?.expired() ?? false,
    timeoutMs: resolved.timeoutMs,
    maxOutput: resolved.params.maxOutput,
    fromOverride: resolved.fromOverride,
    window: check.window,
    promptEstimate: check.estimate,
    contextWindowFailureOf: (error) => (error instanceof ContextWindowError ? error.failure : null),
    capabilityHintOf: (error) => capabilityHintOf(error, sent.carried()),
    promptSections: () => sectionsAgainst(counted, check.estimate()),
    tokensOf: (usage) => tokenFiguresOf(usage, providerType),
  }
}

function sectionsAgainst(
  counted: CountedSections | null,
  estimate: number | null,
): PromptSections | null {
  return counted === null || estimate === null ? null : promptSectionsOf(counted, estimate)
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
  if (opts.repair === false) return schema.parse(JSON.parse(raw))
  const keys = schemaKeys(schema)
  let obj: unknown
  try {
    obj = JSON.parse(raw)
  } catch {
    obj = JSON.parse(jsonrepair(restoreKeyQuotes(raw, keys)))
  }
  return schema.parse(restoreColonKeys(obj, keys))
}

// Every property name the schema declares, at any depth; none when it has no JSON Schema form.
function schemaKeys(schema: z.ZodType): ReadonlySet<string> {
  const keys = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    const { properties } = node as { properties?: unknown }
    if (properties !== null && typeof properties === 'object')
      for (const key of Object.keys(properties)) keys.add(key)
    for (const child of Object.values(node)) walk(child)
  }
  try {
    walk(z.toJSONSchema(schema))
  } catch {
    keys.clear()
  }
  return keys
}

// A key that dropped its closing quote: `"ref: "c2",`, `"severity: 1,`, or with the quote moved
// past the value, `"placements: []",`. jsonrepair can't tell where that quote belonged, and the
// last two fail the reply. Models pretty-print a key per line, so a line opening on a schema key
// and a colon gets its quote back; another word there may be a string, as in an array.
const SLIPPED_KEY = /^(\s*)"([A-Za-z_$][\w$]*):\s*(.*)$/

function restoreKeyQuotes(text: string, keys: ReadonlySet<string>): string {
  return text
    .split('\n')
    .map((line) => {
      const [, indent = '', key = '', rest = ''] = SLIPPED_KEY.exec(line) ?? []
      return keys.has(key) ? `${indent}"${key}": ${slippedValue(rest)}` : line
    })
    .join('\n')
}

// A quote closing the line after the value was the key's: what precedes it is the value, kept when
// it is JSON and quoted when not. A whole string, or a line with no quote, is the value as it is;
// `"role:": "target"` has its quote, and only a stray colon to lose.
function slippedValue(rest: string): string {
  const [, afterStray] = /^"\s*:\s*(.*)$/.exec(rest) ?? []
  if (afterStray !== undefined) return afterStray
  if (/^"(?:[^"\\]|\\.)*"/.test(rest)) return rest
  const [, value, tail] = /^(.*)"([\s,}\]]*)$/.exec(rest) ?? []
  if (value === undefined) return rest
  return `${isJson(value) ? value : JSON.stringify(value)}${tail ?? ''}`
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

// A colon left inside a key's quotes, `"role:": "target"`, is still JSON, and a compact reply's
// `"turn: "t2"` comes back from jsonrepair as {"turn: ": "t2"}. Either key loses its colon when its
// bare name is one the schema declares and the object doesn't already hold.
function restoreColonKeys(value: unknown, schemaKeys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => restoreColonKeys(item, schemaKeys))
  if (value === null || typeof value !== 'object') return value
  const keys = Object.keys(value)
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => {
      const name = key.replace(/\s*:\s*$/, '')
      const restored = name !== key && schemaKeys.has(name) && !keys.includes(name)
      return [restored ? name : key, restoreColonKeys(inner, schemaKeys)]
    }),
  )
}

export type StructuredCallOptions = {
  /** Mark the system prefix for caching; honoured on `anthropic` providers only. */
  cacheSystemPrefix?: boolean
  /** The run's action, linking the call's fetch capture (observability.md → actionId threading);
   *  `null` outside a run, as for the wizard. Required so no call compiles without one. */
  actionId: string | null
  /** The prompt by section: counted before the request, its user half primed for the check. */
  sections?: PromptSectionsInput
  /** Sent as the max output when the resolved settings set none; a cut-off reports this figure. */
  defaultMaxOutput?: number
}

// A reply without them (a fake returning only text) reads as finished, with no counts.
type StructuredReply = {
  text: string
  finishReason: FinishReason | undefined
  usage: LanguageModelUsage | undefined
}

/** generation-pipeline.md → Two retry tiers: `recoverable` holds each retried attempt. */
export type GenerateStructuredResult<T> =
  | {
      status: 'ok'
      value: T
      recoverable: readonly CallRetryError[]
      /** The kept attempt's counts, as the provider reported them. */
      tokens?: TokenFigures
      /** The prompt by section, when the call was given its sections. */
      promptSections?: PromptSections
    }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'failed'; error: CallRetryError; recoverable: readonly CallRetryError[] }
  | { status: 'aborted'; recoverable: readonly CallRetryError[] }

/** A failure as text for logs and failure details; a parse failure's may span lines. */
export function describeCallRetryError(error: CallRetryError): string {
  switch (error.tier) {
    case 'provider':
      return error.detail ?? error.reason
    case 'parse':
      return error.detail
    case 'context-window':
      return describeContextWindow(error)
    case 'reply-cut-off':
      return describeReplyCutOff(error)
  }
}

/**
 * Resolve `target`'s model, call it with `prompt`, and parse the reply against `schema`, retrying
 * provider and parse failures. A call over a known window is refused unsent; a window failure,
 * checked or provider-reported, is never retried.
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
  const { providerId, modelId, providerType } = resolved
  const attribution = options.actionId === null ? undefined : { actionId: options.actionId }
  // Cut-off replies → The cause: a cut names this figure, never the body's max_tokens.
  const maxOutput = resolved.params.maxOutput ?? options.defaultMaxOutput

  // toJSONSchema throws on a transform (a refinement renders as its plain schema): return a typed
  // failure, not a raw rejection past the caller's runAction wrapper.
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
  const check = windowCheck(config.providers, providerId, modelId, attribution)
  const sent = carriedCapabilities()
  const injected = resolved.params.structuredOutput !== 'force-on'
  // The contract's texts count under `output`; the user text is primed as sent, closing included.
  const contract = injected ? promptContract(jsonSchema) : null
  const counted =
    options.sections === undefined
      ? null
      : countSections(options.sections, {
          contract: contract === null ? [] : [contract.system, contract.closing],
          providerId,
          modelId,
          ...attribution,
        })
  if (counted !== null) {
    if (contract === null) primePromptCount(prompt.user, counted.userTokens)
    else
      primePromptCount(
        withClosing(prompt.user, contract.closing),
        counted.userTokens + countPromptText(contract.closing),
      )
  }
  // 'auto' puts the schema in the prompt (no capability signal yet); 'force-on' sends it natively.
  // Marker after the contract: on a blank system half, promptSchemaMiddleware makes the system
  // message. Window check last, to count the contract too (architecture.md → The pre-send check).
  const model = withMiddleware(resolved.model, [
    jsonResponseFormatMiddleware(jsonSchema),
    ...(injected ? [promptSchemaMiddleware()] : []),
    ...(marksSystemPrefix(options.cacheSystemPrefix, resolved.providerType)
      ? [anthropicCacheMarkerMiddleware()]
      : []),
    sent.middleware,
    check.middleware,
  ])

  const logCutOff = (
    failure: ReplyCutOffFailure,
    outcome: { outcome: 'accepted' } | { outcome: 'refused'; parseError: string },
  ): void => {
    logger.warn('provider.reply_cut_off', { ...outcome, target, ...failure }, attribution)
  }
  // generation-pipeline.md → Cut-off replies: a cut reply is accepted only as a strict document,
  // since jsonrepair would close a truncated one into a valid but shorter reply.
  const parseReply = (reply: StructuredReply): T => {
    if (reply.finishReason === 'content-filter') {
      try {
        return parseStructured(reply.text, schema, { repair: false })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(`content filter stopped the reply: ${message}`)
      }
    }
    if (!isCutOff(reply.finishReason)) return parseStructured(reply.text, schema)
    const failure = replyCutOff({
      usage: reply.usage,
      maxOutput,
      window: check.window.tokens,
      promptEstimate: check.estimate(),
      providerId,
      modelId,
      fromOverride: resolved.fromOverride,
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
  // The attempt whose reply parsed is the one the call returns.
  let kept: StructuredReply | undefined
  const parse = (reply: StructuredReply): T => {
    const value = parseReply(reply)
    kept = reply
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
          ...(maxOutput === undefined ? {} : { maxOutputTokens: maxOutput }),
        })
        checkInputTokens({
          usage: call.usage,
          estimate: check.estimate(),
          providerId,
          modelId,
          providerType,
          ...attribution,
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
    {
      maxProviderAttempts: 2,
      maxParseAttempts: 2,
      signal,
      carried: sent.carried,
      fromOverride: resolved.fromOverride,
    },
  )

  const { recoverable } = result
  if (result.status === 'ok') {
    const tokens = tokenFiguresOf(kept?.usage, providerType)
    const promptSections = sectionsAgainst(counted, check.estimate())
    return {
      status: 'ok',
      value: result.result,
      recoverable,
      ...(tokens !== undefined ? { tokens } : {}),
      ...(promptSections !== null ? { promptSections } : {}),
    }
  }
  if (result.status === 'aborted') return { status: 'aborted', recoverable }
  const { error } = result
  if (error.tier === 'context-window') {
    const { tier: _tier, ...failure } = error
    logger.warn('provider.context_window', { target, ...failure }, attribution)
  }
  return { status: 'failed', error, recoverable }
}
