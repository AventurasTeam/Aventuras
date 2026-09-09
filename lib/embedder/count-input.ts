import { logger } from '@/lib/diagnostics'

import { countTokensLocal } from './local/runtime'
import type { EmbedderConfig } from './types'

export type EmbedderTokenCount = {
  counts: number[]
  /** False when the numbers came from an estimator rather than the model's tokenizer. */
  exact: boolean
}

/**
 * Token counts for text about to be embedded, exact where that is possible.
 *
 * A local model's own tokenizer is both exact and cheap — no inference session,
 * and faster than a tiktoken estimate on the scripts WordPiece fragments. A
 * provider has no tokenizer to load, so it falls to `estimate`, which is injected
 * rather than imported: the estimator lives in the retrieval module, and reaching
 * for it here would point this module at one of its own consumers.
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
    // Routine rather than exceptional: nothing is installed yet on a fresh app,
    // and a counter that vanished in that state would read as a broken field.
    logger.debug('embedder.count_fell_back_to_estimate', {
      modelId: config.modelId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { counts: texts.map(estimate), exact: false }
  }
}
