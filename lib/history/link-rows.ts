import type { Delta } from '@/lib/db'

export const HISTORY_LINK_TABLES = [
  'character_relationships',
  'happening_involvements',
  'happening_awareness',
] as const
export type HistoryLinkTable = (typeof HISTORY_LINK_TABLES)[number]

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
