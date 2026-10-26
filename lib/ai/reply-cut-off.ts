import type { FinishReason, LanguageModelUsage } from 'ai'

import type { CutOffMark } from '../db'

export type CutOffCause = CutOffMark['cause']

/** generation-pipeline.md → Two retry tiers: a reply the server stopped at its limit. */
export type ReplyCutOffFailure = {
  cause: CutOffCause
  /** As the provider reported, reasoning included; null when it reported none, or 0, which is
   *  how OpenAI-compatible reports a missing count. */
  outputTokens: number | null
  /** The part of `outputTokens` spent thinking, when reported; 0 can mean unreported on
   *  OpenAI-compatible. */
  reasoningTokens: number | null
  /** The profile's limit; null when it sets none. */
  maxOutput: number | null
  /** The model's known window; null when unknown. */
  window: number | null
  providerId: string
  modelId: string
}

/** Only `'length'` is a cut-off; any other value, or none, is a finished reply. */
export function isCutOff(finishReason: FinishReason | undefined): boolean {
  return finishReason === 'length'
}

export type ReplyCutOffInput = {
  usage: LanguageModelUsage | undefined
  /** ResolvedParams.maxOutput; undefined when the profile sets none. */
  maxOutput: number | undefined
  /** The model's known window; null when unknown. */
  window: number | null
  /** The request's token estimate; null when not estimated. */
  promptEstimate: number | null
  providerId: string
  modelId: string
}

/** generation-pipeline.md → Cut-off replies: the cause comes from what the call knows. */
export function replyCutOff(input: ReplyCutOffInput): ReplyCutOffFailure {
  // OpenAI-compatible reports a missing count as 0, and a cut reply with truly none is rare.
  const reportedOutput = input.usage?.outputTokens ?? null
  const outputTokens = reportedOutput === 0 ? null : reportedOutput
  const reasoningTokens = input.usage?.outputTokenDetails?.reasoningTokens ?? null
  const maxOutput = input.maxOutput ?? null
  const { window, promptEstimate } = input
  const cause: CutOffCause =
    maxOutput !== null && (outputTokens === null || outputTokens >= maxOutput)
      ? 'max-output'
      : window !== null && promptEstimate !== null && promptEstimate + (outputTokens ?? 0) >= window
        ? 'window'
        : 'unknown'
  return {
    cause,
    outputTokens,
    reasoningTokens,
    maxOutput,
    window,
    providerId: input.providerId,
    modelId: input.modelId,
  }
}

/** Thrown by a structured parse step so callWithRetry returns the cut-off at once. */
export class ReplyCutOffError extends Error {
  readonly failure: ReplyCutOffFailure
  constructor(failure: ReplyCutOffFailure) {
    super(describeReplyCutOff(failure))
    this.name = 'ReplyCutOffError'
    this.failure = failure
  }
}

/** One English line for logs and failure details; names the cause verbatim. */
export function describeReplyCutOff(failure: ReplyCutOffFailure): string {
  const counts = [
    failure.outputTokens !== null
      ? `${failure.outputTokens} output tokens`
      : 'output tokens not reported',
    // 0 reads as unreported: OpenAI-compatible reports a missing count as 0.
    ...((failure.reasoningTokens ?? 0) > 0 ? [`${failure.reasoningTokens} reasoning`] : []),
    ...(failure.cause === 'max-output' && failure.maxOutput !== null
      ? [`max output ${failure.maxOutput}`]
      : []),
    ...(failure.cause === 'window' && failure.window !== null ? [`window ${failure.window}`] : []),
  ]
  return (
    `reply cut off (${failure.cause}): ${counts.join(', ')}; ` +
    `model ${failure.modelId} on provider ${failure.providerId}`
  )
}
