import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { chapters } from './story-entries.table'

// Writable (delta-logged) chapter columns, derived from the Drizzle table.
export const chapterWriteSchema = createInsertSchema(chapters, {
  keywords: z.array(z.string()).optional(),
}).omit({ id: true, branchId: true, embeddingStale: true, createdAt: true, updatedAt: true })

export type ChapterWrite = z.infer<typeof chapterWriteSchema>
