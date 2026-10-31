import type { FinishReason, LanguageModelUsage } from 'ai'

import type { CutOffMark } from '../db'

export type CutOffCause = CutOffMark['cause']

/** generation-pipeline.md → Two retry tiers: a reply the server stopped before it finished. */
export type ReplyCutOffFailure = {
  cause: CutOffCause
  /** As the provider reported; null when it reported none. Includes reasoning. */
  outputTokens: number | null
  /** The part of `outputTokens` spent thinking; unreported is null, or 0 on OpenAI-compatible. */
  reasoningTokens: number | null
  /** The max output the call sent; null when it sent none, as under a story model override. */
  maxOutput: number | null
  /** The model's known window; null when unknown. */
  window: number | null
  providerId: string
  modelId: string
}

/** On a structured call only `'length'` is a cut-off; generateStructured treats a filter apart. */
export function isCutOff(finishReason: FinishReason | undefined): boolean {
  return finishReason === 'length'
}

export type ReplyStop = 'length' | 'interrupted' | 'content-filter'

/** Why the stream ended short, else null (generation-pipeline.md → Cut-off replies).
 *  `other` with no raw reason = no finish signal arrived. */
export function replyStopOf(
  finishReason: FinishReason | undefined,
  rawFinishReason: string | undefined,
): ReplyStop | null {
  if (finishReason === 'length' || finishReason === 'content-filter') return finishReason
  return finishReason === 'other' && rawFinishReason === undefined ? 'interrupted' : null
}

export type ReplyCutOffInput = {
  /** A cause of its own beats anything the limits say; a `length` stop reads them. */
  stop?: ReplyStop
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
  const outputTokens = input.usage?.outputTokens ?? null
  const reasoningTokens = input.usage?.outputTokenDetails?.reasoningTokens ?? null
  const maxOutput = input.maxOutput ?? null
  const { window, promptEstimate } = input
  // 0 reads as unreported: OpenAI-compatible reports a missing count as 0.
  const reportedInput = input.usage?.inputTokens
  const promptTokens = reportedInput ? reportedInput : promptEstimate
  const cause: CutOffCause =
    input.stop === 'interrupted' || input.stop === 'content-filter'
      ? input.stop
      : maxOutput !== null && (outputTokens === null || outputTokens >= maxOutput)
        ? 'max-output'
        : window !== null && promptTokens !== null && promptTokens + (outputTokens ?? 0) >= window
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
