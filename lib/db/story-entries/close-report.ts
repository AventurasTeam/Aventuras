import { z } from 'zod'

import { logger } from '@/lib/diagnostics'

export const CLOSE_TASKS = [
  'happenings',
  'lore',
  'identity',
  'threads',
  'upkeep',
  'lifecycle',
  'awareness',
] as const

export type CloseTask = (typeof CLOSE_TASKS)[number]

/** C4: every reason a close records; `other` stands for one no key covers. */
export const CLOSE_REASON_KEYS = [
  'user-edited-since-prose',
  'later-turn',
  'row-gone',
  'turns-empty',
  'turns-full-id',
  'not-a-turn',
  'turn-not-shown',
  'why-empty',
  'unread',
  'id-shape',
  'id-full',
  'id-unknown',
  'id-wrong-kind',
  'turn-in-text',
  'keyword-holds-id',
  'keyword-in-both',
  'nothing-sent',
  'parent-and-top',
  'title-blank',
  'body-blank',
  'lore-cap',
  'title-taken',
  'body-over-limit',
  'body-growth',
  'not-a-character',
  'not-a-faction',
  'over-soft-cap',
  'not-a-place',
  'not-an-item',
  'not-a-location',
  'not-a-place-or-item',
  'not-unplaced',
  'parent-not-a-place',
  'retired-parent',
  'parent-cycle',
  'parent-chain-broken',
  'story-inside',
  'keyword-user-added',
  'keyword-pairs-flag',
  'location',
  'not-active',
  'not-staged',
  'in-scene-later',
  'partner-is-self',
  'partner-not-of-kind',
  'already-flagged',
  'flag-held-by-partner',
  'pair-resolved',
  'merge-absorb-empty',
  'merge-keep-absorbed',
  'merge-repeated',
  'merge-active-into-inactive',
  'merge-mode-into-other',
  'merge-close-wrote',
  'merge-no-keep',
  'merge-close-wrote-no-keep',
  'merge-outside-cluster',
  'no-start-pin',
  'frequent-pin-lowered',
  'pin-raise-too-large',
  'other',
] as const

export type CloseReasonKey = (typeof CLOSE_REASON_KEYS)[number]

/** C4: the value a close records for a place it marks top level, the move its flag alone can't name. */
export const CLOSE_TOP_LEVEL_VALUE = 'top level'

const REASON_KEYS: ReadonlySet<string> = new Set(CLOSE_REASON_KEYS)

export function isCloseReasonKey(value: string): value is CloseReasonKey {
  return REASON_KEYS.has(value)
}

const closeTaskSchema = z.enum(CLOSE_TASKS)
const partSchema = z.number().int().min(0)

// Not strict: v1 may gain a field (milestone C4), and a reader built before it must still parse.
const storedCallSchema = z.object({
  task: closeTaskSchema,
  /** From 1; 0 for the chapter-wide Happenings and Awareness. */
  part: partSchema,
  tool: z.string(),
  /** A refused create keeps its minted id. */
  rows: z.array(z.object({ table: z.string(), id: z.string(), name: z.string() })),
  why: z.string(),
  /** Entry ids. */
  turns: z.array(z.string()),
  result: z.enum(['ok', 'rejected', 'skipped']),
  // Any string: a report stored before reasons were keys must still parse, its reason as other.
  reason: z.string().optional(),
  /** Delta path to the new or proposed value. */
  values: z.record(z.string(), z.string()).optional(),
  skippedFields: z.array(z.object({ field: z.string(), reason: z.string() })).optional(),
  /** A landed merge's kept row. */
  survivor: z.object({ table: z.string(), id: z.string() }).optional(),
})

type StoredCall = z.infer<typeof storedCallSchema>

/** One tool call of a close, in run order (milestone C4). */
export type CloseReportCall = Omit<StoredCall, 'reason' | 'skippedFields'> & {
  /** Why it didn't land: the first refusal's, else the first protection's. */
  reason?: CloseReasonKey
  /** C4: lost paths with their first loss's reason; set for an ok call or one whose losses differ. */
  skippedFields?: { field: string; reason: CloseReasonKey }[]
}

/** C4: a call's landed paths, the keys of `values` less its `skippedFields`. */
export function landedPaths(call: CloseReportCall): string[] {
  const lost = new Set((call.skippedFields ?? []).map(({ field }) => field))
  return Object.keys(call.values ?? {}).filter((path) => !lost.has(path))
}

const storedReportSchema = z.object({
  version: z.literal(1),
  actionId: z.string(),
  calls: z.array(storedCallSchema),
  stopped: z.array(
    z.object({
      task: closeTaskSchema,
      part: partSchema,
      reason: z.enum(['budget', 'window', 'cut-off']),
    }),
  ),
  /** No task called a tool. */
  noToolCalls: z.boolean(),
})

/** `chapters.close_report`: what a close's deltas don't hold (milestone C4). */
export type CloseReport = Omit<z.infer<typeof storedReportSchema>, 'calls'> & {
  calls: CloseReportCall[]
}

/** Each call's reasons as keys; `unknown` gathers unmatched strings, null a refusal's missing one. */
function keyedCalls(calls: readonly StoredCall[], unknown: Set<string | null>): CloseReportCall[] {
  const keyOf = (reason: string): CloseReasonKey => {
    if (isCloseReasonKey(reason)) return reason
    unknown.add(reason)
    return 'other'
  }
  return calls.map(({ reason, skippedFields, ...call }) => {
    if (reason === undefined && call.result !== 'ok') unknown.add(null)
    return {
      ...call,
      ...(reason === undefined ? {} : { reason: keyOf(reason) }),
      ...(skippedFields === undefined
        ? {}
        : {
            skippedFields: skippedFields.map((skipped) => ({
              field: skipped.field,
              reason: keyOf(skipped.reason),
            })),
          }),
    }
  })
}

/** C4: a stored report, each reason a key; one no key matches reads as `other`, logged once. */
export const closeReportSchema = storedReportSchema.transform((stored): CloseReport => {
  const unknown = new Set<string | null>()
  const report = { ...stored, calls: keyedCalls(stored.calls, unknown) }
  if (unknown.size > 0)
    logger.warn(
      'memory.close_report_unknown_reason',
      { reasons: [...unknown] },
      { actionId: stored.actionId },
    )
  return report
})
