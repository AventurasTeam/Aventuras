import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { entities } from './entities.table'

// Writable entity columns, derived from the Drizzle table
export const entityWriteSchema = createInsertSchema(entities, {
  tags: z.array(z.string()).optional(),
  keywords: z.array(z.string()).optional(),
}).omit({
  id: true,
  branchId: true,
  nameCollisionFlag: true,
  state: true,
  embeddingStale: true,
  createdAt: true,
  updatedAt: true,
})

export type EntityWrite = z.infer<typeof entityWriteSchema>
