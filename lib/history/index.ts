export { __setDiffCacheDbForTest, diffCache } from './app-diff-cache'
export {
  loadCloseDeltas,
  readCloseReport,
  readDeletedEntityKinds,
  readLatestCloseReport,
} from './close-read'
export { buildCloseReview, closeTaskLabel } from './close-review'
export { CLOSE_REVIEW_AREAS } from './close-review-types'
export type {
  CloseReview,
  CloseReviewArea,
  CloseReviewChange,
  CloseReviewLookup,
  CloseReviewNotApplied,
  CloseReviewRowRef,
  CloseReviewStopped,
  CloseReviewTarget,
} from './close-review-types'
export {
  createDiffCache,
  DIFF_CACHE_CAPACITY,
  DiffEvictedError,
  type DiffCache,
  type DiffOutcome,
} from './diff-cache'
export { diffProse, type ProseContext, type ProseTarget } from './diff-prose'
export { DiffWalkError, type DiffCacheEntry, type DiffWalk, type UpdateDelta } from './diff-walk'
export { HISTORY_OPS } from './field-labels'
export type { HistoryTable } from './field-labels'
export { humanizeDelta } from './humanize'
export type { HistoryRowView } from './humanize'
export { HISTORY_LINK_WATCH, memoizedLinkEndScan } from './link-ends'
export type { HistoryLinkWatch, ScanLinkEnds } from './link-ends'
export type { HistoryLinkTable, HistoryRow, HistoryVia, LinkSide } from './link-rows'
export { entryIdsOf, refIdsOf, type DiffTable } from './prose-fields'
export { HISTORY_CHUNK_SIZE, loadHistoryChunk } from './query'
export type { HistoryChunk, HistoryOp, HistoryQuery, HistorySort } from './query'
