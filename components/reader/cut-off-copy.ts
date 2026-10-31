import type { ReplyCutOffFailure } from '@/lib/ai'
import type { CutOffMark } from '@/lib/db'
import { t } from '@/lib/i18n'

// The reader document's DOM bundle imports this file: keep runtime imports to lib/i18n.

type CutOffCopy =
  | { key: 'maxOutput' | 'window' | 'unknownWithMaxOutput'; limit: number }
  | { key: 'unknown' }

/**
 * Which copy a cut-off failure takes, and the number it names. A cause without its number reads as
 * `unknown`, as the stored mark does; an `unknown` cut names the max output it fell short of.
 */
export function cutOffCopyOf(failure: ReplyCutOffFailure): CutOffCopy {
  if (failure.cause === 'max-output' && failure.maxOutput != null)
    return { key: 'maxOutput', limit: failure.maxOutput }
  if (failure.cause === 'window' && failure.window != null)
    return { key: 'window', limit: failure.window }
  if (failure.maxOutput != null) return { key: 'unknownWithMaxOutput', limit: failure.maxOutput }
  return { key: 'unknown' }
}

/** The **Reply cut off before any text** entry: the narrative turn committed nothing. */
export function turnCutOffContent(failure: ReplyCutOffFailure): string {
  const copy = cutOffCopyOf(failure)
  // 0 reads as unreported: the OpenAI-compatible provider reports a missing count as 0.
  if (copy.key === 'maxOutput' && failure.reasoningTokens != null && failure.reasoningTokens > 0) {
    return t('reader:systemEntry.failure.replyCutOff.maxOutputReasoning', {
      limit: copy.limit,
      reasoning: failure.reasoningTokens,
    })
  }
  return copy.key === 'unknown'
    ? t('reader:systemEntry.failure.replyCutOff.unknown')
    : t(`reader:systemEntry.failure.replyCutOff.${copy.key}`, { limit: copy.limit })
}

/** A **Memory update failed** entry whose pass reply was cut off. */
export function passCutOffContent(failure: ReplyCutOffFailure): string {
  const copy = cutOffCopyOf(failure)
  return copy.key === 'unknown'
    ? t('reader:systemEntry.failure.memoryCutOff.unknown')
    : t(`reader:systemEntry.failure.memoryCutOff.${copy.key}`, { limit: copy.limit })
}

/** The notice on an `ai_reply` card whose prose ended early. */
export function cutOffNoticeText(mark: CutOffMark): string {
  switch (mark.cause) {
    case 'unknown':
      return mark.maxOutput !== undefined
        ? t('reader:cutOffNotice.unknownWithMaxOutput', { limit: mark.maxOutput })
        : t('reader:cutOffNotice.unknown')
    case 'max-output':
      return t('reader:cutOffNotice.maxOutput', { limit: mark.limit })
    case 'window':
      return t('reader:cutOffNotice.window', { limit: mark.limit })
    case 'interrupted':
      return t('reader:cutOffNotice.interrupted')
    case 'content-filter':
      return t('reader:cutOffNotice.contentFilter')
  }
}

// A window's remedy is `Set window`; a reply that ended early has none in the profile.
const NO_PROFILE_FIX: readonly string[] = [
  'window',
  'interrupted',
  'content-filter',
] satisfies CutOffMark['cause'][]

/** Widened past the cause set: a system entry's cause is a persisted `z.string()`. */
export function offersProfileFix(cause: CutOffMark['cause'] | (string & {}) | undefined): boolean {
  return cause === undefined || !NO_PROFILE_FIX.includes(cause)
}
