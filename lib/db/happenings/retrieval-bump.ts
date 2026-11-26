import type { Delta, HappeningAwareness } from '../types'
import type { happeningAwareness } from './happenings.table'

/** The awareness column a retrieval bumps and a close resets. */
export const RETRIEVAL_COUNT = 'retrievalCount' satisfies keyof HappeningAwareness

/** The one table with a retrieval count. */
export const RETRIEVAL_BUMP_TABLE =
  'happening_awareness' satisfies (typeof happeningAwareness)['_']['name']

/**
 * An awareness update whose undo payload is the retrieval count alone (a turn's bump or a close's
 * reset): it changes nothing a user sees. Every key counts, `$` ones included, as History's
 * json_each count does; an empty or null payload is no bump.
 */
export function isRetrievalBump(delta: Pick<Delta, 'targetTable' | 'op' | 'undoPayload'>): boolean {
  if (delta.targetTable !== RETRIEVAL_BUMP_TABLE || delta.op !== 'update') return false
  const keys = Object.keys(delta.undoPayload ?? {})
  return keys.length === 1 && keys[0] === RETRIEVAL_COUNT
}
