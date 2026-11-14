import { plotHref } from '@/components/plot/plot-selection'
import { railRowHref } from '@/components/reader/rail/rail-row-href'
import type { EntityKind } from '@/lib/db'
import type { CloseReviewRowRef } from '@/lib/history'

/** Liveness, kinds and awareness links the host supplies; `isLive` decides whether a row presses. */
export type ReviewRowLiveness = {
  isLive: (table: string, id: string) => boolean
  entityKind: (id: string) => EntityKind | undefined
  /** A live awareness row's happening. */
  awarenessHappening: (id: string) => string | undefined
}

/** A review row's press: its live row in World or Plot, or null when the row doesn't press. */
export function reviewRowHref(
  branchId: string,
  pressTo: CloseReviewRowRef | null,
  live: ReviewRowLiveness,
): string | null {
  if (pressTo == null || !live.isLive(pressTo.table, pressTo.id)) return null
  const { table, id } = pressTo
  switch (table) {
    case 'lore':
      return railRowHref(branchId, 'lore', id)
    case 'entities': {
      const kind = live.entityKind(id)
      return kind == null ? null : railRowHref(branchId, kind, id)
    }
    case 'threads':
      return railRowHref(branchId, 'thread', id)
    case 'happenings':
      return railRowHref(branchId, 'happening', id)
    case 'happening_awareness': {
      const happening = live.awarenessHappening(id)
      return happening == null || !live.isLive('happenings', happening)
        ? null
        : plotHref(branchId, { kind: 'happening', id: happening, tab: 'awareness' })
    }
    default:
      return null
  }
}
