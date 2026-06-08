import { createInsertSchema } from 'drizzle-zod'
import type { z } from 'zod'

import { branchEraFlips } from './stories.table'

// Writable (delta-logged) era-flip columns.
export const branchEraFlipWriteSchema = createInsertSchema(branchEraFlips, {
  atWorldtime: (schema) => schema.min(0),
}).omit({ id: true, branchId: true, createdAt: true })

export type BranchEraFlipWrite = z.infer<typeof branchEraFlipWriteSchema>
