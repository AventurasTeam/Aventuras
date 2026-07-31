import { useRouter } from 'expo-router'

import type { ResolveFailureKind } from '@/lib/ai'
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

// Shared by the system-entry bubble and the suggestion strip: a config-resolver
// failure is deterministic, so both surfaces route to settings instead of
// offering a retry that cannot succeed. Widened past ResolveFailureKind because
// the bubble's caller reads a persisted `z.string()`; an unrecognised value
// lands on the generic "Fix default" rather than dropping the affordance.
export function useConfigFixAction(
  failure: ResolveFailureKind | (string & {}) | undefined,
): SystemEntryFixAction {
  const router = useRouter()
  if (failure === undefined) return undefined
  const labelKey =
    failure === 'no-profile-assigned'
      ? 'reader:systemEntry.assignProfile'
      : failure === 'profile-missing'
        ? 'reader:systemEntry.fixProfile'
        : 'reader:systemEntry.fixDefault'
  return { label: t(labelKey), onPress: () => router.push('/settings?tab=providers') }
}

export function useSystemEntryActions(
  failure: SystemFailureMeta | undefined,
  onRetry: () => void,
): { onRetry: () => void; fixAction: SystemEntryFixAction } {
  const fixAction = useConfigFixAction(
    failure?.kind === 'config-resolver' ? failure.failure : undefined,
  )
  return { onRetry, fixAction }
}
