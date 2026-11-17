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

/**
 * The key prefix of the copy that names whose setting the call ran on: the story override's, or the
 * profile's (generation-pipeline.md → Cut-off replies → Whose setting it was). A window or a stop
 * names no setting, so it has one copy.
 */
export function whoseSetting(fromOverride: boolean | undefined): 'override.' | '' {
  return fromOverride === true ? 'override.' : ''
}

/** The **Reply cut off before any text** entry: the narrative turn committed nothing. */
export function turnCutOffContent(failure: ReplyCutOffFailure): string {
  const copy = cutOffCopyOf(failure)
  const whose = whoseSetting(failure.fromOverride)
  // 0 reads as unreported: the OpenAI-compatible provider reports a missing count as 0.
  if (copy.key === 'maxOutput' && failure.reasoningTokens != null && failure.reasoningTokens > 0) {
    return t(`reader:systemEntry.failure.replyCutOff.${whose}maxOutputReasoning`, {
      limit: copy.limit,
      reasoning: failure.reasoningTokens,
    })
  }
  if (copy.key === 'unknown') return t(`reader:systemEntry.failure.replyCutOff.${whose}unknown`)
  if (copy.key === 'window')
    return t('reader:systemEntry.failure.replyCutOff.window', { limit: copy.limit })
  return t(`reader:systemEntry.failure.replyCutOff.${whose}${copy.key}`, { limit: copy.limit })
}

/** A **Memory update failed** entry whose pass reply was cut off. */
export function passCutOffContent(failure: ReplyCutOffFailure): string {
  const copy = cutOffCopyOf(failure)
  const whose = whoseSetting(failure.fromOverride)
  if (copy.key === 'unknown') return t(`reader:systemEntry.failure.memoryCutOff.${whose}unknown`)
  if (copy.key === 'window')
    return t('reader:systemEntry.failure.memoryCutOff.window', { limit: copy.limit })
  return t(`reader:systemEntry.failure.memoryCutOff.${whose}${copy.key}`, { limit: copy.limit })
}

/** A **Chapter close failed** entry whose close reply was cut off. */
export function closeCutOffContent(failure: ReplyCutOffFailure): string {
  const copy = cutOffCopyOf(failure)
  const whose = whoseSetting(failure.fromOverride)
  if (copy.key === 'unknown') return t(`reader:systemEntry.failure.closeCutOff.${whose}unknown`)
  if (copy.key === 'window')
    return t('reader:systemEntry.failure.closeCutOff.window', { limit: copy.limit })
  return t(`reader:systemEntry.failure.closeCutOff.${whose}${copy.key}`, { limit: copy.limit })
}

/** The notice on an `ai_reply` card whose prose ended early. */
export function cutOffNoticeText(mark: CutOffMark): string {
  switch (mark.cause) {
    case 'unknown': {
      const whose = whoseSetting(mark.fromOverride)
      return mark.maxOutput !== undefined
        ? t(`reader:cutOffNotice.${whose}unknownWithMaxOutput`, { limit: mark.maxOutput })
        : t(`reader:cutOffNotice.${whose}unknown`)
    }
    case 'max-output':
      return t(`reader:cutOffNotice.${whoseSetting(mark.fromOverride)}maxOutput`, {
        limit: mark.limit,
      })
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
