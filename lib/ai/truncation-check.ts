import type { LanguageModelUsage } from 'ai'

import { logger } from '@/lib/diagnostics'

import type { ProviderInstance } from '../db'
import { tokenFiguresOf } from './usage-figures'

/** architecture.md → Truncation cross-check: a starting value for tuning. */
export const TRUNCATION_RATIO = 0.5

export type TruncationNotice = {
  providerId: string
  modelId: string
  reported: number
  estimate: number
}

const notified = new Set<string>()
let noticeSink: ((notice: TruncationNotice) => void) | null = null

export function configureTruncationNotice(sink: ((notice: TruncationNotice) => void) | null): void {
  noticeSink = sink
}

/**
 * After a call, compares the provider's input count with the pre-send estimate: logs the ratio with
 * the provider's cache figures when it reported them, warns below TRUNCATION_RATIO, and notifies once
 * per provider and model per app session.
 */
export function checkInputTokens(input: {
  usage: LanguageModelUsage | undefined
  estimate: number | null
  providerId: string
  modelId: string
  providerType: ProviderInstance['type']
  actionId?: string
}): void {
  const { estimate, providerId, modelId, providerType, actionId } = input
  const reported = input.usage?.inputTokens
  // 0 reads as unreported: OpenAI-compatible reports a missing count as 0.
  if (estimate === null || reported === undefined) return
  if (!(Number.isFinite(estimate) && estimate > 0 && Number.isFinite(reported) && reported > 0))
    return
  const ratio = reported / estimate
  const fields = { providerId, modelId, estimate, reported, ratio }
  const opts = actionId !== undefined ? { actionId } : undefined
  const figures = tokenFiguresOf(input.usage, providerType)
  logger.debug(
    'provider.input_ratio',
    {
      ...fields,
      ...(figures?.cacheRead !== undefined ? { cacheRead: figures.cacheRead } : {}),
      ...(figures?.cacheWrite !== undefined ? { cacheWrite: figures.cacheWrite } : {}),
    },
    opts,
  )
  if (ratio >= TRUNCATION_RATIO) return
  logger.warn('provider.prompt_truncation_suspected', fields, opts)
  const key = JSON.stringify([providerId, modelId])
  if (notified.has(key)) return
  notified.add(key)
  try {
    noticeSink?.({ providerId, modelId, reported, estimate })
  } catch (error) {
    // Inside a call's attempt: a throw here would fail, and retry, a call that succeeded.
    logger.warn(
      'provider.truncation_notice_failed',
      { providerId, modelId, error: error instanceof Error ? error.message : String(error) },
      opts,
    )
  }
}

export function __resetTruncationCheck(): void {
  notified.clear()
  noticeSink = null
}
