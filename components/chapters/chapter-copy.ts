import type { ChapterSaveRejectionCode } from '@/lib/actions'
import { isChapterIssue, type ChapterDraft } from '@/lib/chapters'
import { t } from '@/lib/i18n'

// Exhaustive: a new draft field fails typecheck until it has a label.
const FIELD_LABEL: Record<keyof ChapterDraft, () => string> = {
  title: () => t('chapters:fields.title'),
  theme: () => t('chapters:fields.theme'),
  summary: () => t('chapters:fields.summary'),
  keywords: () => t('chapters:fields.keywords'),
}

/** save-sessions.md → Save bar: user-recognizable field names; an unknown field passes through. */
export function chapterFieldLabel(field: string): string {
  return Object.hasOwn(FIELD_LABEL, field) ? FIELD_LABEL[field as keyof ChapterDraft]() : field
}

/** A draft-schema issue message (a key) → its text; unknown messages pass through. */
export function chapterIssueText(message: string): string {
  return isChapterIssue(message) ? t(`chapters:validation.${message}`) : message
}

// Exhaustive: a new ChapterSaveRejectionCode fails typecheck until it has text here.
const SAVE_REJECTION_TEXT: Record<ChapterSaveRejectionCode, () => string> = {
  'in-flight': () => t('chapters:save.inFlight'),
  'not-found': () => t('chapters:save.notFound'),
  failed: () => t('chapters:save.failed'),
}

/** A refused save's user-facing text; the action's own reasons are developer strings. */
export function chapterSaveRejectionText(code: ChapterSaveRejectionCode): string {
  return SAVE_REJECTION_TEXT[code]()
}

export function chapterSaveFailureText(): string {
  return t('chapters:save.failed')
}

/** chapter-timeline.md → Collapsed state: `840 tok` under a thousand, else `12.4k tok`. */
export function compactTokenLabel(count: number): string {
  if (count < 1000) return t('chapters:tokens.compact', { value: count })
  // Math.round, not toFixed: toFixed keeps a trailing `.0` and rounds 12.45 down.
  return t('chapters:tokens.compactThousands', { value: Math.round(count / 100) / 10 })
}

export function fullTokenLabel(count: number): string {
  return t('chapters:tokens.full', { count })
}

export function chapterHeading(number: number, title: string): string {
  return t('chapters:card.heading', { number, title })
}

export function timelineHeader(closedCount: number): string {
  return t('chapters:timeline.header', { closed: closedCount })
}

export function entryRangeLabel({ first, last }: { first: number; last: number }): string {
  return t('chapters:card.entries', { first, last })
}

/** `closed_at` is unix ms. */
export function closedAtLabel(closedAt: number): string {
  const date = t('relativeTime.dateWithYear', { date: new Date(closedAt) })
  return t('chapters:card.closedAt', { date })
}
