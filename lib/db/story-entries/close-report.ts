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

/** One tool call of a close, in run order (milestone C4). */
export type CloseReportCall = {
  task: CloseTask
  /** From 1; 0 for the chapter-wide Happenings and Awareness. */
  part: number
  tool: string
  /** A refused create keeps its minted id. */
  rows: { table: string; id: string; name: string }[]
  why: string
  /** Entry ids. */
  turns: string[]
  result: 'ok' | 'rejected' | 'skipped'
  /** Why it didn't land, whole. */
  reason?: string
  /** Delta path to the new or proposed value. */
  values?: Record<string, string>
  /** A partly landed call. */
  skippedFields?: { field: string; reason: string }[]
  /** A landed merge's kept row. */
  survivor?: { table: string; id: string }
}

/** `chapters.close_report`: what a close's deltas don't hold (milestone C4). */
export type CloseReport = {
  version: 1
  actionId: string
  calls: CloseReportCall[]
  stopped: { task: CloseTask; part: number; reason: 'budget' | 'window' | 'cut-off' }[]
  /** No task called a tool. */
  noToolCalls: boolean
}

const closeTaskSchema = z.enum(CLOSE_TASKS)
const partSchema = z.number().int().min(0)

// Not strict: v1 may gain a field (milestone C4), and a reader built before it must still parse.
export const closeReportCallSchema: z.ZodType<CloseReportCall> = z.object({
  task: closeTaskSchema,
  part: partSchema,
  tool: z.string(),
  rows: z.array(z.object({ table: z.string(), id: z.string(), name: z.string() })),
  why: z.string(),
  turns: z.array(z.string()),
  result: z.enum(['ok', 'rejected', 'skipped']),
  reason: z.string().optional(),
  values: z.record(z.string(), z.string()).optional(),
  skippedFields: z.array(z.object({ field: z.string(), reason: z.string() })).optional(),
  survivor: z.object({ table: z.string(), id: z.string() }).optional(),
})

export const closeReportSchema: z.ZodType<CloseReport> = z.object({
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
  noToolCalls: z.boolean(),
})
