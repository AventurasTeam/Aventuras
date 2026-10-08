import { z } from 'zod'

import type { Happening } from '@/lib/db'
import { t } from '@/lib/i18n'

import { avtsEnvelope, type AvtsFile } from './envelope'
import { optionalText, requiredText } from './fields'
import { avtsFileName } from './file-name'

export type HappeningImport = {
  title: string
  description: string | null
  category: string | null
  icon: string | null
  temporal: string | null
  commonKnowledge: 0 | 1
}

export const HappeningImportSchema: z.ZodType<HappeningImport> = z
  .object({
    title: requiredText(() => t('common:avts.issue.titleRequired')),
    description: optionalText,
    category: optionalText,
    icon: optionalText,
    temporal: optionalText,
    commonKnowledge: z
      .union([z.literal(0), z.literal(1), z.boolean()])
      .default(0)
      .transform((value): 0 | 1 => (value === 1 || value === true ? 1 : 0)),
    // Only for data-model.md's time-anchor exclusivity, then dropped: entry ids are branch-local.
    occurredAtEntryId: optionalText,
  })
  .refine((happening) => !(happening.occurredAtEntryId != null && happening.temporal != null), {
    path: ['occurredAtEntryId'],
    error: () => t('common:avts.issue.timeAnchorExclusive'),
  })
  .transform(({ occurredAtEntryId, ...happening }) => happening)

export function happeningExport(row: Happening, exportedAt: Date): AvtsFile {
  const payload: HappeningImport = {
    title: row.title,
    description: row.description,
    category: row.category,
    icon: row.icon,
    temporal: row.temporal,
    commonKnowledge: row.commonKnowledge === 1 ? 1 : 0,
  }
  return {
    fileName: avtsFileName('happening', row.title),
    contents: avtsEnvelope('happening', payload, exportedAt),
  }
}
