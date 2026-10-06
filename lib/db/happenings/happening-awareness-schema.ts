import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { happeningAwareness } from './happenings.table'

// retrieval_count: not a write field here; the awareness arm validates a create's count itself.
export const happeningAwarenessWriteSchema = createInsertSchema(happeningAwareness, {
  decayResistance: z.number().min(0).max(1).nullable().optional(),
}).omit({ id: true, branchId: true, retrievalCount: true })

export type HappeningAwarenessWrite = z.infer<typeof happeningAwarenessWriteSchema>
