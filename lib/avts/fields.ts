import { z } from 'zod'

import { t } from '@/lib/i18n'
import { blankToNull } from '@/lib/text'

/** Trimmed, non-blank text; missing, null, empty or whitespace-only fails with `message`. */
export function requiredText(message: () => string) {
  return z
    .string({ error: (issue) => (issue.input == null ? message() : undefined) })
    .trim()
    .min(1, { error: message })
}

/** Free text that may be absent: missing, null, empty or whitespace-only reads as null. */
export const optionalText = z
  .string()
  .nullish()
  .transform((value) => (value == null ? null : blankToNull(value)))

export const termList = z.array(z.string()).default([])

const priorityRange = () => t('common:avts.issue.priorityRange')

/** A whole number from 0 to 100; 0 when absent. */
export const priorityField = z
  .number({ error: priorityRange })
  .int({ error: priorityRange })
  .min(0, { error: priorityRange })
  .max(100, { error: priorityRange })
  .default(0)
