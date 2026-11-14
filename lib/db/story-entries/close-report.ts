import { z } from 'zod'

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
export const closeReportCallSchema = z.object({
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
  /** Why it didn't land: the first refusal's, else the first protection's. */
  reason: z.string().optional(),
  /** Delta path to the new or proposed value. */
  values: z.record(z.string(), z.string()).optional(),
  /**
   * Lost paths with their first loss's reason: an ok call's that landed on no row, and a call's
   * where nothing landed when they don't all share its reason (C4).
   */
  skippedFields: z.array(z.object({ field: z.string(), reason: z.string() })).optional(),
  /** A landed merge's kept row. */
  survivor: z.object({ table: z.string(), id: z.string() }).optional(),
})

/** One tool call of a close, in run order (milestone C4). */
export type CloseReportCall = z.infer<typeof closeReportCallSchema>

export const closeReportSchema = z.object({
  version: z.literal(1),
  actionId: z.string(),
  calls: z.array(closeReportCallSchema),
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
export type CloseReport = z.infer<typeof closeReportSchema>
