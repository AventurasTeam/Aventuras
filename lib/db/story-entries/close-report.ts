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
  /** Why it didn't land, whole. */
  reason: z.string().optional(),
  /** Delta path to the new or proposed value. */
  values: z.record(z.string(), z.string()).optional(),
  /** A partly landed call. */
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
