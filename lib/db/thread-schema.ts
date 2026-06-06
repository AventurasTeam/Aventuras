import { z } from 'zod'

const injectionMode = z.enum(['always', 'auto', 'disabled'])

// Writable (delta-logged) thread columns. The two *_at_entry_id fields are
// branch-scoped story_entries.id strings (FK-less); '' is normalized to null at
// the write boundary (see lib/actions/coerce.ts), so they are plain nullable
// strings here.
export const threadWriteSchema = z.object({
  title: z.string(),
  description: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  icon: z.string().nullable().default(null),
  status: z.enum(['pending', 'active', 'resolved', 'failed']),
  injectionMode,
  triggeredAtEntryId: z.string().nullable().default(null),
  resolvedAtEntryId: z.string().nullable().default(null),
})

export type ThreadWrite = z.infer<typeof threadWriteSchema>
