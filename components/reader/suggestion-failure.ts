import { describeContextWindow, displayEstimate, type ResolveFailureKind } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { SUGGESTIONS_UNUSABLE, type PipelineError } from '@/lib/pipeline'

import { windowSourceLabel } from './context-window-copy'
import { cutOffCopyOf } from './cut-off-copy'

const SUGGESTION_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:suggestions.failure.noProfileAssigned',
  'profile-missing': 'reader:suggestions.failure.profileMissing',
  'provider-missing': 'reader:suggestions.failure.providerMissing',
  'override-provider-missing': 'reader:suggestions.failure.overrideProviderMissing',
} as const satisfies Record<ResolveFailureKind, string>

function suggestionWindowCopy(error: Extract<PipelineError, { kind: 'context-window' }>): string {
  if (error.detectedBy === 'provider') {
    return t('reader:suggestions.failure.contextWindow.provider', {
      message: error.detail?.trim() ? error.detail : describeContextWindow(error),
    })
  }
  // The check never refuses without a window; with no figure to print, the generic body.
  if (error.window === null) return t('reader:suggestions.errorBody')
  return t('reader:suggestions.failure.contextWindow.check', {
    estimate: displayEstimate(error.estimate),
    model: error.modelId,
    window: error.window,
    source: windowSourceLabel(error.windowSource),
  })
}

// Strip-scoped copy rather than describeTurnFailure's: that names the narrative
// agent, so reusing it would point a reader at the wrong setting. The fix
// action is shared (useConfigFixAction) because the remedy is the same screen.
export function describeSuggestionFailure(error: PipelineError | null | undefined): string {
  if (error?.kind === 'phase-logic' && error.subsystem === SUGGESTIONS_UNUSABLE)
    return t('reader:suggestions.failure.unusable')
  if (error?.kind === 'reply-cut-off') {
    const copy = cutOffCopyOf(error)
    return copy.key === 'unknown'
      ? t('reader:suggestions.failure.cutOff.unknown')
      : t(`reader:suggestions.failure.cutOff.${copy.key}`, { limit: copy.limit })
  }
  if (error?.kind === 'context-window') return suggestionWindowCopy(error)
  if (error?.kind === 'provider') return t('reader:suggestions.failure.llmCall')
  if (error?.kind === 'config-resolver') return t(SUGGESTION_RESOLVER_COPY[error.failure])
  return t('reader:suggestions.errorBody')
}
