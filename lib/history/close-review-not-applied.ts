import type { CloseReasonKey, CloseReport, CloseReportCall } from '@/lib/db'
import { t } from '@/lib/i18n'

import {
  CREATE_LORE_TOOL,
  landedPaths,
  reviewFieldLabel,
  reviewRowKey,
  reviewTarget,
  reviewValueText,
  sameRow,
} from './close-review-changes'
import type {
  CloseReview,
  CloseReviewField,
  CloseReviewLookup,
  CloseReviewNotApplied,
} from './close-review-types'

const REASON_COPY = {
  'user-edited-since-prose': 'chapters:review.reason.user-edited-since-prose',
  'later-turn': 'chapters:review.reason.later-turn',
  'row-gone': 'chapters:review.reason.row-gone',
  'turns-empty': 'chapters:review.reason.turns-empty',
  'turns-full-id': 'chapters:review.reason.turns-full-id',
  'not-a-turn': 'chapters:review.reason.not-a-turn',
  'turn-not-shown': 'chapters:review.reason.turn-not-shown',
  'why-empty': 'chapters:review.reason.why-empty',
  unread: 'chapters:review.reason.unread',
  'id-shape': 'chapters:review.reason.id-shape',
  'id-full': 'chapters:review.reason.id-full',
  'id-unknown': 'chapters:review.reason.id-unknown',
  'id-wrong-kind': 'chapters:review.reason.id-wrong-kind',
  'turn-in-text': 'chapters:review.reason.turn-in-text',
  'keyword-holds-id': 'chapters:review.reason.keyword-holds-id',
  'keyword-in-both': 'chapters:review.reason.keyword-in-both',
  'nothing-sent': 'chapters:review.reason.nothing-sent',
  'parent-and-top': 'chapters:review.reason.parent-and-top',
  'title-blank': 'chapters:review.reason.title-blank',
  'body-blank': 'chapters:review.reason.body-blank',
  'lore-cap': 'chapters:review.reason.lore-cap',
  'title-taken': 'chapters:review.reason.title-taken',
  'body-over-limit': 'chapters:review.reason.body-over-limit',
  'body-growth': 'chapters:review.reason.body-growth',
  'not-a-character': 'chapters:review.reason.not-a-character',
  'not-a-faction': 'chapters:review.reason.not-a-faction',
  'over-soft-cap': 'chapters:review.reason.over-soft-cap',
  'not-a-place': 'chapters:review.reason.not-a-place',
  'not-an-item': 'chapters:review.reason.not-an-item',
  'not-a-location': 'chapters:review.reason.not-a-location',
  'not-a-place-or-item': 'chapters:review.reason.not-a-place-or-item',
  'not-unplaced': 'chapters:review.reason.not-unplaced',
  'parent-not-a-place': 'chapters:review.reason.parent-not-a-place',
  'retired-parent': 'chapters:review.reason.retired-parent',
  'parent-cycle': 'chapters:review.reason.parent-cycle',
  'parent-chain-broken': 'chapters:review.reason.parent-chain-broken',
  'story-inside': 'chapters:review.reason.story-inside',
  'keyword-user-added': 'chapters:review.reason.keyword-user-added',
  'keyword-pairs-flag': 'chapters:review.reason.keyword-pairs-flag',
  location: 'chapters:review.reason.location',
  'not-active': 'chapters:review.reason.not-active',
  'not-staged': 'chapters:review.reason.not-staged',
  'in-scene-later': 'chapters:review.reason.in-scene-later',
  'partner-is-self': 'chapters:review.reason.partner-is-self',
  'partner-not-of-kind': 'chapters:review.reason.partner-not-of-kind',
  'already-flagged': 'chapters:review.reason.already-flagged',
  'flag-held-by-partner': 'chapters:review.reason.flag-held-by-partner',
  'pair-resolved': 'chapters:review.reason.pair-resolved',
  'merge-absorb-empty': 'chapters:review.reason.merge-absorb-empty',
  'merge-keep-absorbed': 'chapters:review.reason.merge-keep-absorbed',
  'merge-repeated': 'chapters:review.reason.merge-repeated',
  'merge-active-into-inactive': 'chapters:review.reason.merge-active-into-inactive',
  'merge-mode-into-other': 'chapters:review.reason.merge-mode-into-other',
  'merge-close-wrote': 'chapters:review.reason.merge-close-wrote',
  'merge-no-keep': 'chapters:review.reason.merge-no-keep',
  'merge-close-wrote-no-keep': 'chapters:review.reason.merge-close-wrote-no-keep',
  'merge-outside-cluster': 'chapters:review.reason.merge-outside-cluster',
  'no-start-pin': 'chapters:review.reason.no-start-pin',
  'frequent-pin-lowered': 'chapters:review.reason.frequent-pin-lowered',
  'pin-raise-too-large': 'chapters:review.reason.pin-raise-too-large',
  other: 'chapters:review.reason.other',
} as const satisfies Record<CloseReasonKey, string>

export const MERGE_TOOLS: ReadonlySet<string> = new Set(['merge_threads', 'merge_happenings'])

// data-model.md → LocationState shape: a place's parent and its unplaced mark are one field.
export const PLACEMENT_PATHS: ReadonlySet<string> = new Set([
  'state.parent_location_id',
  'state.unplaced',
])
const fieldOf = (path: string): string => (PLACEMENT_PATHS.has(path) ? 'placement' : path)

const titleKey = (title: string): string => title.trim().toLowerCase()

type Row = CloseReportCall['rows'][number]
type Refusal = {
  index: number
  call: CloseReportCall
  /** A field row's path; null for a row by tool and rows. */
  path: string | null
  summary: string
  reason: CloseReasonKey | undefined
}

const sharesRow = (a: readonly Row[], b: readonly Row[]): boolean =>
  a.some((row) => b.some((other) => sameRow(row, other)))

function createdTitle(call: CloseReportCall): string {
  return titleKey(call.values?.title ?? call.rows[0]?.name ?? '')
}

// A refused create's minted id is one no retry shares, so it matches by title. A row with no
// `values` matches a landing on a row they share, or any landing of the tool when it named none:
// its rows are every id argument, a landed call's the tool's own.
function corrected({ call, path }: Refusal, later: CloseReportCall): boolean {
  if (path === null) {
    if (call.tool === CREATE_LORE_TOOL && call.values !== undefined)
      return createdTitle(later) === createdTitle(call)
    return call.rows.length === 0 || sharesRow(call.rows, later.rows)
  }
  if (!sharesRow(call.rows, later.rows)) return false
  const field = fieldOf(path)
  return landedPaths(later).some((landed) => fieldOf(landed) === field)
}

/** chapter-close.md → Review: is this refusal a slip its task later corrected with the same tool? */
function correctedLater(refusal: Refusal, calls: readonly CloseReportCall[]): boolean {
  return calls.some(
    (later, index) =>
      index > refusal.index &&
      later.result === 'ok' &&
      later.task === refusal.call.task &&
      later.tool === refusal.call.tool &&
      corrected(refusal, later),
  )
}

function refusalsOf(call: CloseReportCall, index: number, lookup: CloseReviewLookup): Refusal[] {
  const table = call.rows[0]?.table ?? ''
  const ownReason = (path: string): CloseReasonKey | undefined =>
    call.skippedFields?.find(({ field }) => field === path)?.reason ?? call.reason
  if (call.result === 'ok')
    return (call.skippedFields ?? []).map(({ field, reason }) => {
      const value = call.values?.[field]
      return {
        index,
        call,
        path: field,
        summary: value === undefined ? '' : reviewValueText({ table, path: field }, value, lookup),
        reason,
      }
    })
  if (MERGE_TOOLS.has(call.tool))
    return [
      {
        index,
        call,
        path: null,
        summary: call.values?.description ?? call.values?.title ?? '',
        reason: call.reason,
      },
    ]
  if (call.tool === CREATE_LORE_TOOL)
    return [
      {
        index,
        call,
        path: null,
        summary: call.values?.body ?? call.values?.title ?? call.rows[0]?.name ?? '',
        reason: call.reason,
      },
    ]
  // An empty record is as good as none: the refusal still shows, by its tool.
  const proposed = Object.entries(call.values ?? {})
  if (proposed.length === 0) return [{ index, call, path: null, summary: '', reason: call.reason }]
  return proposed.map(([path, value]) => ({
    index,
    call,
    path,
    summary: reviewValueText({ table, path }, value, lookup),
    reason: ownReason(path),
  }))
}

/**
 * chapter-close.md → Review: the writes that didn't land, by field, less the slips their task
 * later corrected with the same tool; each with its proposed value and its reason's label.
 */
export function closeReviewNotApplied(
  report: CloseReport,
  lookup: CloseReviewLookup,
): CloseReview['notApplied'] {
  return report.calls
    .flatMap((call, index) => refusalsOf(call, index, lookup))
    .filter((refusal) => !correctedLater(refusal, report.calls))
    .map((refusal): CloseReviewNotApplied => {
      const { call, path } = refusal
      const [first] = call.rows
      const created = call.tool === CREATE_LORE_TOOL
      // A refusal stored with no reason, which closeReportSchema logged.
      const reasonKey = refusal.reason ?? 'other'
      const field: CloseReviewField =
        path === null
          ? { fieldPath: null, fieldLabel: null }
          : { fieldPath: path, fieldLabel: reviewFieldLabel(first?.table ?? '', path) }
      return {
        key: reviewRowKey(refusal.index, first ?? { table: '', id: '' }, path ?? call.tool),
        op: created ? 'create' : 'update',
        tool: call.tool,
        target: first === undefined ? null : reviewTarget(first, lookup),
        ...field,
        summary: refusal.summary,
        reasonKey,
        reasonText: t(REASON_COPY[reasonKey]),
        pressTo:
          first === undefined || (created && call.result !== 'ok')
            ? null
            : { table: first.table, id: first.id },
      }
    })
}
