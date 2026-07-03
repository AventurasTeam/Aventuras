import type { z } from 'zod'

import {
  callWithRetry,
  getModel,
  resolveModel,
  runProviderCall,
  type CallRetryError,
  type ResolveFailureKind,
  type ResolveModelConfig,
} from '@/lib/ai'

import { parseStructured } from './assist-schemas'

export type WizardAssistResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'not-configured'; kind: ResolveFailureKind }
  | { status: 'failed'; detail: string }
  | { status: 'aborted' }

function describeCallRetryError(error: CallRetryError): string {
  return error.tier === 'provider' ? (error.detail ?? error.reason) : error.detail
}

export async function runWizardAssist<T>(
  prompt: string,
  schema: z.ZodType<T>,
  config: ResolveModelConfig,
  signal: AbortSignal,
): Promise<WizardAssistResult<T>> {
  const resolved = resolveModel('wizard-assist', config)
  if (!resolved.ok) return { status: 'not-configured', kind: resolved.kind }

  const model = getModel(resolved.providerId, resolved.modelId)
  const result = await callWithRetry<T>(
    async (sig) => (await runProviderCall({ model, prompt, abortSignal: sig })).text,
    (raw) => parseStructured(raw, schema),
    { maxProviderAttempts: 2, maxParseAttempts: 2, signal },
  )

  if (result.status === 'ok') return { status: 'ok', value: result.result }
  if (result.status === 'aborted') return { status: 'aborted' }
  return { status: 'failed', detail: describeCallRetryError(result.error) }
}
