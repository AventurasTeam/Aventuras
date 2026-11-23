import type { Delta } from '@/lib/db'

export const HISTORY_LINK_TABLES = [
  'character_relationships',
  'happening_involvements',
  'happening_awareness',
] as const
export type HistoryLinkTable = (typeof HISTORY_LINK_TABLES)[number]

/** The awareness column a retrieval bumps: an update changing only it isn't listed. */
export const RETRIEVAL_COUNT = 'retrievalCount'

/** The table whose updates of the retrieval count alone History leaves out. */
export const RETRIEVAL_BUMP_TABLE = 'happening_awareness'

/** An awareness update whose payload is the retrieval count alone, as the History query skips. */
export function isRetrievalBump(delta: Pick<Delta, 'targetTable' | 'op' | 'undoPayload'>): boolean {
  if (delta.targetTable !== RETRIEVAL_BUMP_TABLE || delta.op !== 'update') return false
  // Every key counts, `$` ones included, as the query's json_each count does.
  const keys = Object.keys(delta.undoPayload ?? {})
  return keys.length === 1 && keys[0] === RETRIEVAL_COUNT
}

/** Which end of a relationship row the tab's row is ('a' holds `kind`); null for other links. */
export type LinkSide = 'a' | 'b' | null

/**
 * How a delta reaches a History tab's row: its own, a link row naming it, or the other end's
 * delete. A relationship link always names its side, since its labels depend on it.
 */
export type HistoryVia =
  | { kind: 'own' }
  | {
      kind: 'link'
      table: 'character_relationships'
      linkId: string
      otherId: string
      side: 'a' | 'b'
    }
  | {
      kind: 'link'
      table: Exclude<HistoryLinkTable, 'character_relationships'>
      linkId: string
      otherId: string
      side: null
    }
  | {
      kind: 'removed'
      tables: readonly [HistoryLinkTable, ...HistoryLinkTable[]]
      otherId: string
    }

export type HistoryRow = { delta: Delta; via: HistoryVia }
