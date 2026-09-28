import { t } from '@/lib/i18n'

/** DeltaLogRow's `createdAtRelative`; both args unix ms. */
export function relativeTimeLabel(thenMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - thenMs) / 1000))
  if (seconds < 60) return t('history:relative.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('history:relative.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('history:relative.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('history:relative.days', { count: days })
  return t('history:relative.weeks', { count: Math.floor(days / 7) })
}
