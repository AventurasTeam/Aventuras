import { z } from 'zod'

import { INJECTION_MODES, type Lore } from '@/lib/db'
import { t } from '@/lib/i18n'

import { avtsEnvelope, type AvtsFile } from './envelope'
import { optionalText, priorityField, requiredText, termList } from './fields'
import { avtsFileName } from './file-name'

export type LoreImport = {
  title: string
  body: string
  category: string | null
  tags: string[]
  keywords: string[]
  injectionMode: Lore['injectionMode']
  priority: number
}

// world.md → Required body: whitespace-only is empty, on the JSON path as in the pane.
export const LoreImportSchema: z.ZodType<LoreImport> = z.object({
  title: requiredText(() => t('common:avts.issue.titleRequired')),
  body: requiredText(() => t('common:avts.issue.bodyRequired')),
  category: optionalText,
  tags: termList,
  keywords: termList,
  injectionMode: z.enum(INJECTION_MODES),
  priority: priorityField,
})

export function loreExport(row: Lore, exportedAt: Date): AvtsFile {
  const payload: LoreImport = {
    title: row.title,
    body: row.body ?? '',
    category: row.category,
    tags: [...row.tags],
    keywords: [...row.keywords],
    injectionMode: row.injectionMode,
    priority: row.priority,
  }
  return {
    fileName: avtsFileName('lore', row.title),
    contents: avtsEnvelope('lore', payload, exportedAt),
  }
}
