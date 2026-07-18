import type { LanguageModel } from 'ai'

import type { ProviderInstance } from '../db'
import type { ResolveTarget } from './agents'
import { getModel } from './model'
import {
  resolveModel,
  type ResolveFailureKind,
  type ResolveModelConfig,
  type ResolvedParams,
} from './resolve-model'
import { streamProviderCall } from './transport/provider-call'

export type ProviderCallOptions = {
  temperature?: number
  maxOutputTokens?: number
  timeout?: { totalMs: number }
  providerOptions?: {
    anthropic: { thinking: { type: 'enabled'; budgetTokens: number } | { type: 'disabled' } }
  }
}

// Single owner of the ResolvedParams → SDK call-option mapping. Thinking is
// anthropic-only: other provider types would reject the providerOptions key.
export function buildProviderCallOptions(
  params: ResolvedParams,
  providerType: ProviderInstance['type'] | undefined,
): ProviderCallOptions {
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

export type ResolvedProviderCall =
  | {
      ok: true
      model: LanguageModel
      callOptions: ProviderCallOptions
      providerId: string
      modelId: string
      params: ResolvedParams
    }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

export function resolveProviderCall(
  target: ResolveTarget,
  config: ResolveModelConfig,
  actionId?: string,
): ResolvedProviderCall {
  const resolved = resolveModel(target, config)
  if (!resolved.ok) return resolved
  const providerType = config.providers.find((p) => p.id === resolved.providerId)?.type
  return {
    ok: true,
    model: getModel(resolved.providerId, resolved.modelId, actionId),
    callOptions: buildProviderCallOptions(resolved.params, providerType),
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    params: resolved.params,
  }
}

export type StreamAgentCallOptions = {
  prompt: string
  config: ResolveModelConfig
  abortSignal?: AbortSignal
  actionId?: string
  onError?: (event: { error: unknown }) => void
}

export type StreamAgentCallResult =
  | { ok: true; stream: ReturnType<typeof streamProviderCall>; modelId: string }
  | { ok: false; kind: ResolveFailureKind; target: ResolveTarget }

export function streamAgentCall(
  target: ResolveTarget,
  opts: StreamAgentCallOptions,
): StreamAgentCallResult {
  const resolved = resolveProviderCall(target, opts.config, opts.actionId)
  if (!resolved.ok) return resolved
  const stream = streamProviderCall({
    model: resolved.model,
    prompt: opts.prompt,
    ...(opts.abortSignal !== undefined ? { abortSignal: opts.abortSignal } : {}),
    ...(opts.onError !== undefined ? { onError: opts.onError } : {}),
    ...resolved.callOptions,
  })
  return { ok: true, stream, modelId: resolved.modelId }
}
