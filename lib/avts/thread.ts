import { z } from 'zod'

import { INJECTION_MODES, THREAD_STATUSES, type Thread } from '@/lib/db'
import { t } from '@/lib/i18n'

import { avtsEnvelope, type AvtsFile } from './envelope'
import { optionalText, requiredText } from './fields'
import { avtsFileName } from './file-name'

export type ThreadImport = {
  title: string
  description: string | null
  category: string | null
  icon: string | null
  status: Thread['status']
  injectionMode: Thread['injectionMode']
}

export const ThreadImportSchema: z.ZodType<ThreadImport> = z.object({
  title: requiredText(() => t('common:avts.issue.titleRequired')),
  description: optionalText,
  category: optionalText,
  icon: optionalText,
  status: z.enum(THREAD_STATUSES),
  injectionMode: z.enum(INJECTION_MODES),
})

export function threadExport(row: Thread, exportedAt: Date): AvtsFile {
  const payload: ThreadImport = {
    title: row.title,
    description: row.description,
    category: row.category,
    icon: row.icon,
    status: row.status,
    injectionMode: row.injectionMode,
  }
  return {
    fileName: avtsFileName('thread', row.title),
    contents: avtsEnvelope('thread', payload, exportedAt),
  }
}
