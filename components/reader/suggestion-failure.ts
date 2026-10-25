import type { ResolveFailureKind } from '@/lib/ai'
import { t } from '@/lib/i18n'
import { SUGGESTIONS_UNUSABLE, type PipelineError } from '@/lib/pipeline'

const SUGGESTION_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:suggestions.failure.noProfileAssigned',
  'profile-missing': 'reader:suggestions.failure.profileMissing',
  'provider-missing': 'reader:suggestions.failure.providerMissing',
  'override-provider-missing': 'reader:suggestions.failure.overrideProviderMissing',
} as const satisfies Record<ResolveFailureKind, string>

// Strip-scoped copy rather than describeTurnFailure's: that names the narrative
// agent, so reusing it would point a reader at the wrong setting. The fix
// action is shared (useConfigFixAction) because the remedy is the same screen.
export function describeSuggestionFailure(error: PipelineError | null | undefined): string {
  if (error?.kind === 'phase-logic' && error.subsystem === SUGGESTIONS_UNUSABLE)
    return t('reader:suggestions.failure.unusable')
  if (error?.kind === 'provider') return t('reader:suggestions.failure.llmCall')
  if (error?.kind === 'config-resolver') return t(SUGGESTION_RESOLVER_COPY[error.failure])
  return t('reader:suggestions.errorBody')
}
