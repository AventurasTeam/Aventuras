import type { CloseReasonKey, CloseTask, EntityKind } from '@/lib/db'

/** chapter-timeline.md → Review window: the Changes areas, in canon's order. */
export const CLOSE_REVIEW_AREAS = [
  'lore',
  'charactersAndFactions',
  'placesAndItems',
  'threads',
  'happenings',
  'awareness',
] as const

export type CloseReviewArea = (typeof CLOSE_REVIEW_AREAS)[number]

export type CloseReviewRowRef = { table: string; id: string }

export type CloseReviewTarget = CloseReviewRowRef & { name: string }

export type CloseReviewLookup = {
  /** The live store's kind, else the latest delete delta's (readDeletedEntityKinds). */
  entityKind: (id: string) => EntityKind | undefined
  /** A live row's display name, any table. */
  nameOf: (id: string) => string | undefined
  /** An entry's position on the branch. */
  entryPosition: (id: string) => number | undefined
}

export type CloseReviewChange = {
  key: string
  op: 'create' | 'update' | 'delete'
  area: CloseReviewArea
  target: CloseReviewTarget
  /** The delta path; null on a create or delete. */
  fieldPath: string | null
  fieldLabel: string | null
  summary: string
  why: string
  /** The call's latest cited turn, or null. */
  entryId: string | null
  /** An absorbed row's survivor, else the target. */
  pressTo: CloseReviewRowRef
}

export type CloseReviewNotApplied = {
  key: string
  /** `create` for a refused `create_lore`, else `update`: the row's op badge. */
  op: 'create' | 'update'
  tool: string
  /** The call's first row; null when it recorded none. */
  target: CloseReviewTarget | null
  fieldPath: string | null
  fieldLabel: string | null
  /** The proposed value as shown, a refused merge's text, a refused create's body, or ''. */
  summary: string
  reasonKey: CloseReasonKey
  /** `t('chapters:review.reason.<key>')`. */
  reasonText: string
  /** The first row (a refused merge's keep); null for a refused create or no rows. */
  pressTo: CloseReviewRowRef | null
}

export type CloseReviewStopped = {
  task: CloseTask
  part: number
  reason: 'budget' | 'window' | 'cut-off'
  /** The line as shown: task, part unless 0, reason. */
  text: string
}

export type CloseReview = {
  stopped: readonly CloseReviewStopped[]
  noToolCalls: boolean
  notApplied: readonly CloseReviewNotApplied[]
  changes: readonly { area: CloseReviewArea; rows: readonly CloseReviewChange[] }[]
}
