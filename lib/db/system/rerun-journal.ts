import { z } from 'zod'

/** `reversal_journals.journal`: a re-run's undo half (generation-pipeline.md → Reverse-replay). */
export type RerunJournal = {
  version: 1
  chapterId: string
  /** The chapter's sequence_number, for the fallback's toast once the row is gone. */
  chapterNumber: number
  /** The highest log_position the reversal left on the branch. */
  floor: number
  /** Each row the plan writes, by table and id: its whole row before, or null when absent. */
  rows: { table: string; id: string; before: Record<string, unknown> | null }[]
  /** Each delta row the plan prunes, re-owns or rewrites, whole, as logged before. */
  deltas: Record<string, unknown>[]
  /** Each earlier reversal_journals row the plan drops, whole. */
  journals: { actionId: string; journal: unknown; createdAt: number }[]
}

const wholeRow = z.record(z.string(), z.unknown())

// A new shape takes a new version, so v1 parses strictly.
export const rerunJournalSchema: z.ZodType<RerunJournal> = z.strictObject({
  version: z.literal(1),
  chapterId: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  floor: z.number().int().min(0),
  rows: z.array(
    z.strictObject({
      table: z.string().min(1),
      id: z.string().min(1),
      before: wholeRow.nullable(),
    }),
  ),
  deltas: z.array(wholeRow),
  // Strips a dropped row's branch_id: the write-back stamps the executing branch on restore.
  journals: z.array(
    z.object({ actionId: z.string().min(1), journal: z.unknown(), createdAt: z.number().int() }),
  ),
})

/** Throws on an unknown version or shape. */
export function parseRerunJournal(raw: unknown): RerunJournal {
  return rerunJournalSchema.parse(raw)
}
