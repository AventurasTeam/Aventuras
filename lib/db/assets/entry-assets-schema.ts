import { createInsertSchema } from 'drizzle-zod'
import { type z } from 'zod'

import { entryAssets } from './assets.table'

export const entryAssetWriteSchema = createInsertSchema(entryAssets).omit({
  id: true,
  branchId: true,
})

export type EntryAssetWrite = z.infer<typeof entryAssetWriteSchema>
