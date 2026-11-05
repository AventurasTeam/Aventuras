import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { closeReportSchema } from './close-report'
import { chapters } from './story-entries.table'

// Writable (delta-logged) chapter columns, derived from the Drizzle table.
export const chapterWriteSchema = createInsertSchema(chapters, {
  keywords: z.array(z.string()).optional(),
  // The JSON column alone would take any JSON.
  closeReport: closeReportSchema.nullable().optional(),
}).omit({ id: true, branchId: true, embeddingStale: true, createdAt: true, updatedAt: true })

export type ChapterWrite = z.infer<typeof chapterWriteSchema>
