import type { z } from 'zod'

import { boundedSignal } from '@/lib/abort'
import {
  callTimeoutMs,
  generateStructured,
  type CallRetryError,
  type GenerateStructuredResult,
  type PromptHalves,
  type ResolveModelConfig,
  type ResolveTarget,
  type StructuredCallOptions,
} from '@/lib/ai'

import {
  retriedAttemptEvents,
  structuredCallFailure,
  type StructuredCallFailure,
} from './call-error'
import type { PhaseEmittedEvent, PipelineError } from './types'

export type BoundedStructuredOutcome<T> =
  | { status: 'ok'; value: T; recoverable: readonly CallRetryError[] }
  | { status: 'aborted' }
  | { status: 'failed'; error: PipelineError; lastError: string; cause: StructuredCallFailure }

/**
 * One structured call under its agent's bound (callTimeoutMs): a cancel is `aborted`, an expiry a
 * provider timeout.
 */
export async function* boundedStructuredCall<T>(call: {
  target: ResolveTarget
  phaseName: string
  prompt: PromptHalves
  schema: z.ZodType<T>
  config: ResolveModelConfig
  signal: AbortSignal
  /** No `sections`: the outcome drops the call's section counts. */
  options: Pick<StructuredCallOptions, 'actionId' | 'defaultMaxOutput'> & { sections?: never }
}): AsyncGenerator<PhaseEmittedEvent, BoundedStructuredOutcome<T>> {
  const timeoutMs = callTimeoutMs(call.target, call.config)
  const bounded = boundedSignal(call.signal, timeoutMs)
  // Named, not passed whole: an upcast options value can still carry sections.
  const { actionId, defaultMaxOutput } = call.options
  let result: GenerateStructuredResult<T>
  try {
    result = await generateStructured(
      call.target,
      call.prompt,
      call.schema,
      call.config,
      bounded.signal,
      defaultMaxOutput === undefined ? { actionId } : { actionId, defaultMaxOutput },
    )
  } finally {
    bounded.dispose()
  }
  yield* retriedAttemptEvents(result, call.target)
  if (result.status === 'ok')
    return { status: 'ok', value: result.value, recoverable: result.recoverable }
  // An expiry aborts the call as a cancel does, but it is the provider's fault, so it fails.
  if (result.status === 'aborted' && !bounded.expired()) return { status: 'aborted' }
  const { error, lastError } = structuredCallFailure(result, {
    target: call.target,
    phaseName: call.phaseName,
    timeoutMs,
  })
  return { status: 'failed', error, lastError, cause: result }
}
