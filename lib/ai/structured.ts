import { wrapLanguageModel } from 'ai'
import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'

import { resolveProviderCall } from './agent-call'
import { type ResolveTarget } from './agents'
import {
  jsonResponseFormatMiddleware,
  promptSchemaMiddleware,
  type JsonSchema,
} from './prompt-schema'
import { type ResolveFailureKind, type ResolveModelConfig } from './resolve-model'
import { callWithRetry, type CallRetryError } from './transport/call-with-retry'
import { runProviderCall } from './transport/provider-call'

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
  const resolved = resolveProviderCall(target, config)
  if (!resolved.ok) return { status: 'not-configured', kind: resolved.kind }

  const jsonSchema = z.toJSONSchema(schema) as JsonSchema
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
          ...resolved.callOptions,
        })
      ).text,
    (raw) => parseStructured(raw, schema),
    { maxProviderAttempts: 2, maxParseAttempts: 2, signal },
  )

  if (result.status === 'ok') return { status: 'ok', value: result.result }
  if (result.status === 'aborted') return { status: 'aborted' }
  return { status: 'failed', detail: describeCallRetryError(result.error) }
}
