import type { ResolveFailureKind } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { SUGGESTIONS_UNUSABLE, type PipelineError } from '@/lib/pipeline'

import { windowCopyOf } from './context-window-copy'
import { cutOffKeyOf } from './cut-off-copy'

const SUGGESTION_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:suggestions.failure.noProfileAssigned',
  'profile-missing': 'reader:suggestions.failure.profileMissing',
  'provider-missing': 'reader:suggestions.failure.providerMissing',
  'override-provider-missing': 'reader:suggestions.failure.overrideProviderMissing',
} as const satisfies Record<ResolveFailureKind, string>

function suggestionWindowCopy(error: Extract<PipelineError, { kind: 'context-window' }>): string {
  const copy = windowCopyOf(error)
  // The check never refuses without a window; with no figure to print, the generic body.
  return copy === null
    ? t('reader:suggestions.errorBody')
    : t(`reader:suggestions.failure.contextWindow.${copy.key}`, copy.values)
}

// Strip-scoped copy rather than describeTurnFailure's: that names the narrative
// agent, so reusing it would point a reader at the wrong setting. The fix
// action is shared (useConfigFixAction) because the remedy is the same screen.
export function describeSuggestionFailure(error: PipelineError | null | undefined): string {
  if (error?.kind === 'phase-logic' && error.subsystem === SUGGESTIONS_UNUSABLE)
    return t('reader:suggestions.failure.unusable')
  if (error?.kind === 'reply-cut-off') {
    const { key, values } = cutOffKeyOf(error)
    return t(`reader:suggestions.failure.cutOff.${key}`, values)
  }
  if (error?.kind === 'context-window') return suggestionWindowCopy(error)
  if (error?.kind === 'provider') return t('reader:suggestions.failure.llmCall')
  // Only a close's pre-flight raises 'tool-calling-off', so the strip never words it.
  if (error?.kind === 'config-resolver')
    return error.failure === 'tool-calling-off'
      ? t('reader:suggestions.errorBody')
      : t(SUGGESTION_RESOLVER_COPY[error.failure])
  return t('reader:suggestions.errorBody')
}
