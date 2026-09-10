import { logger } from '@/lib/diagnostics'

import { countTokensLocal } from './local/runtime'
import type { EmbedderConfig } from './types'

export type EmbedderTokenCount = {
  counts: number[]
  /** False when the numbers came from an estimator rather than the model's tokenizer. */
  exact: boolean
}

/**
 * Token counts for text about to be embedded, exact where that is possible: a local
 * model's own tokenizer is exact and cheap, a provider has none and falls to
 * `estimate`. That is injected rather than imported — the estimator lives in the
 * retrieval module, which is one of this module's own consumers.
 */
export async function countEmbedderTokens(
  config: EmbedderConfig,
  texts: string[],
  estimate: (text: string) => number,
): Promise<EmbedderTokenCount> {
  if (texts.length === 0) return { counts: [], exact: true }
  if (config.backend === 'provider') {
    return { counts: texts.map(estimate), exact: false }
  }
  try {
    return { counts: await countTokensLocal(config.modelId, texts), exact: true }
  } catch (error) {
    // Routine on a fresh app with nothing installed; a vanished counter reads as broken.
    logger.debug('embedder.count_fell_back_to_estimate', {
      modelId: config.modelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { counts: texts.map(estimate), exact: false }
  }
}
