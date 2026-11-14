import { t } from '@/lib/i18n'

/** Ascending, consecutive chapter numbers as copy: `5`, `5 and 6`, `5–7`. */
export function chapterListLabel(numbers: readonly number[]): string {
  if (numbers.length === 0) return ''
  const first = numbers[0]
  const last = numbers[numbers.length - 1]
  if (numbers.length === 1) return String(first)
  if (numbers.length === 2) return t('reader:rollbackConfirm.chapterPair', { first, second: last })
  return t('reader:rollbackConfirm.chapterSpan', { first, last })
}
