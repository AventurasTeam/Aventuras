import { abortCauseOf } from '@/lib/abort'
import { logger } from '@/lib/diagnostics'

import { EmbedderCallError, EmbedderCancelledError } from '../types'

/**
 * The error an aborted local embed raises, identically on both platforms.
 *
 * A user stop and a bounded-signal expiry abort identically, separable only from
 * the signal's reason — so neither runtime classifies for itself: misreading an
 * expiry as a cancel demotes a 300s provider timeout to a debug entry.
 */
export function abortedEmbedError(signal: AbortSignal): EmbedderCallError | EmbedderCancelledError {
  if (abortCauseOf(signal) === 'timeout') {
    logger.error('embedder.local_runtime_failed', { kind: 'call', error: 'embed timed out' })
    return new EmbedderCallError('embed timed out')
  }
  logger.debug('embedder.local_embed_cancelled', { error: 'embed cancelled' })
  return new EmbedderCancelledError('embed cancelled')
}
