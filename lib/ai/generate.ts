import { wrapLanguageModel, type LanguageModel } from 'ai'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'

import type { ProviderInstance } from '../db'
import type { ResolveTarget } from './agents'
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

// Single owner of the ResolvedParams → SDK call-settings mapping. Thinking is
// anthropic-only: other provider types would reject the providerOptions key.
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
    ...(params.timeout !== undefined ? { timeout: { totalMs: params.timeout * 1000 } } : {}),
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
  const providerType = config.providers.find((p) => p.id === resolved.providerId)?.type
  return {
    ok: true,
    model: getModel(resolved.providerId, resolved.modelId, actionId),
    callSettings: buildCallSettings(resolved.params, providerType),
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    params: resolved.params,
  }
}

export type StreamTextOptions = {
  prompt: string
  config: ResolveModelConfig
  abortSignal?: AbortSignal
  actionId?: string
  onError?: (event: { error: unknown }) => void
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
    model: resolved.model,
    prompt: opts.prompt,
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

export type GenerateStructuredResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'failed'; detail: string }
  | { status: 'aborted' }

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
  prompt: string,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  signal: AbortSignal,
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
    return { status: 'failed', detail: err instanceof Error ? err.message : String(err) }
  }
  // 'auto' takes the prompt-injection path: there is no provider capability
  // signal yet, so native responseFormat stays opt-in via 'force-on'.
  const model = wrapLanguageModel({
    // getModel only ever returns provider instances, never the
    // gateway-model-id string arm of LanguageModel.
    model: resolved.model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware:
      resolved.params.structuredOutput === 'force-on'
        ? [jsonResponseFormatMiddleware(jsonSchema)]
        : [jsonResponseFormatMiddleware(jsonSchema), promptSchemaMiddleware()],
  })

  const result = await callWithRetry<T>(
    async (sig) =>
      (
        await runProviderCall({
          model,
          prompt,
          abortSignal: sig,
          ...resolved.callSettings,
        })
      ).text,
    (raw) => parseStructured(raw, schema),
    { maxProviderAttempts: 2, maxParseAttempts: 2, signal },
  )

  if (result.status === 'ok') return { status: 'ok', value: result.result }
  if (result.status === 'aborted') return { status: 'aborted' }
  return { status: 'failed', detail: describeCallRetryError(result.error) }
}
