import { useRouter } from 'expo-router'

import type { SystemFailureMeta } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { PipelineError } from '@/lib/pipeline'

export type SystemEntryFixAction = { label: string; onPress: () => void } | undefined

// Per-kind bubble copy (reader-composer.md → Error surface), resolved at write
// time so the persisted entry keeps its vocabulary across an app restart.
export function describeTurnFailure(error: PipelineError | undefined): {
  content: string
  detail?: string
} {
  if (error?.kind === 'provider') {
    return {
      content: t('reader:systemEntry.failure.llmCall'),
      detail: error.detail != null ? `${error.reason}: ${error.detail}` : error.reason,
    }
  }
  if (error?.kind === 'config-resolver') {
    const contentKey =
      error.failure === 'no-profile-assigned'
        ? 'reader:systemEntry.failure.noProfileAssigned'
        : error.failure === 'profile-missing'
          ? 'reader:systemEntry.failure.profileMissing'
          : 'reader:systemEntry.failure.providerMissing'
    return { content: t(contentKey), detail: error.detail }
  }
  return { content: t('reader:systemEntry.failureMessage'), detail: error?.detail }
}

export function toSystemFailureMeta(
  error: PipelineError | undefined,
  submission: { content: string; composerMode: string } | undefined,
): SystemFailureMeta {
  const { detail } = describeTurnFailure(error)
  return {
    kind: error?.kind ?? 'orchestrator',
    ...(error?.kind === 'config-resolver' ? { failure: error.failure } : {}),
    ...(detail != null ? { detail } : {}),
    ...(submission != null ? { submission } : {}),
  }
}

export function useSystemEntryActions(
  failure: SystemFailureMeta | undefined,
  onRetry: () => void,
): { onRetry: () => void; fixAction: SystemEntryFixAction } {
  const router = useRouter()

  function navigateToProviderSettings() {
    router.push('/settings?tab=providers')
  }

  let fixAction: SystemEntryFixAction
  if (failure?.kind === 'config-resolver') {
    const labelKey =
      failure.failure === 'no-profile-assigned'
        ? 'reader:systemEntry.assignProfile'
        : failure.failure === 'profile-missing'
          ? 'reader:systemEntry.fixProfile'
          : 'reader:systemEntry.fixDefault'
    fixAction = { label: t(labelKey), onPress: navigateToProviderSettings }
  }

  return { onRetry, fixAction }
}
