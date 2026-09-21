import { t } from '@/lib/i18n'

/** `entry #n` — the one place the label is spelled (data-model.md → Entry references are IDs). */
export function formatEntryRef(position: number): string {
  return t('entryRef', { n: position })
}
