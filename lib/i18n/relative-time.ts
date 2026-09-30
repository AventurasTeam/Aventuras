import { t } from './i18n'

/**
 * History's `createdAtRelative` and the story card's `lastOpenedRelative`; both args unix ms.
 * Relative under a week, then the date and time in the shape the locale string sets
 * (delta-log-row.md → Meta line).
 */
export function relativeTimeLabel(thenMs: number, nowMs: number): string {
  const seconds = Math.floor((nowMs - thenMs) / 1000)
  if (seconds < 60) return t('relativeTime.justNow')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('relativeTime.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('relativeTime.hours', { count: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return t('relativeTime.days', { count: days })
  const date = new Date(thenMs)
  return date.getFullYear() === new Date(nowMs).getFullYear()
    ? t('relativeTime.date', { date })
    : t('relativeTime.dateWithYear', { date })
}
