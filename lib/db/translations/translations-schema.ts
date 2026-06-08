import { createInsertSchema } from 'drizzle-zod'
import { z } from 'zod'

import { translations } from './translations.table'

// translated_text is nullable in DDL, but a row only exists for a completed translation
// (failures write no row), so the write path requires it non-empty.
export const translationWriteSchema = createInsertSchema(translations, {
  translatedText: z.string().min(1),
}).omit({ id: true, branchId: true, createdAt: true, updatedAt: true })

export type TranslationWrite = z.infer<typeof translationWriteSchema>
