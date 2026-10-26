import type { ReplyCutOffFailure } from '@/lib/ai'
import type { CutOffMark } from '@/lib/db'
import { t } from '@/lib/i18n'

// The reader document's DOM bundle imports this file: keep runtime imports to lib/i18n.

/** The **Reply cut off before any text** entry: the narrative turn committed nothing. */
export function turnCutOffContent(failure: ReplyCutOffFailure): string {
  if (failure.cause === 'max-output' && failure.maxOutput != null) {
    // 0 reads as unreported: the OpenAI-compatible provider reports a missing count as 0.
    if (failure.reasoningTokens != null && failure.reasoningTokens > 0) {
      return t('reader:systemEntry.failure.replyCutOff.maxOutputReasoning', {
        limit: failure.maxOutput,
        reasoning: failure.reasoningTokens,
      })
    }
    return t('reader:systemEntry.failure.replyCutOff.maxOutput', { limit: failure.maxOutput })
  }
  if (failure.cause === 'window' && failure.window != null) {
    return t('reader:systemEntry.failure.replyCutOff.window', { limit: failure.window })
  }
  return t('reader:systemEntry.failure.replyCutOff.unknown')
}

/** A **Memory update failed** entry whose pass reply was cut off. */
export function passCutOffContent(failure: ReplyCutOffFailure): string {
  if (failure.cause === 'max-output' && failure.maxOutput != null) {
    return t('reader:systemEntry.failure.memoryCutOff.maxOutput', { limit: failure.maxOutput })
  }
  if (failure.cause === 'window' && failure.window != null) {
    return t('reader:systemEntry.failure.memoryCutOff.window', { limit: failure.window })
  }
  return t('reader:systemEntry.failure.memoryCutOff.unknown')
}

/** The notice on an `ai_reply` card whose prose the server cut off. */
export function cutOffNoticeText(mark: CutOffMark): string {
  if (mark.cause === 'max-output' && mark.limit != null) {
    return t('reader:cutOffNotice.maxOutput', { limit: mark.limit })
  }
  if (mark.cause === 'window' && mark.limit != null) {
    return t('reader:cutOffNotice.window', { limit: mark.limit })
  }
  return t('reader:cutOffNotice.unknown')
}
