import { useRouter } from 'expo-router'

import type { ResolveFailureKind } from '@/lib/ai'
import type { SystemFailureMeta } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { PipelineError } from '@/lib/pipeline'
import { openEmbedderSwapDialog } from '@/lib/stores'

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
  if (error?.kind === 'embedder') {
    // One string for every embedder failure: `reason` is lossy — the shared
    // classifyEmbedderFailure (lib/retrieval/sync.ts) buckets any untyped throw
    // (a locked DB, a bug) into 'init' on both the sync-stage and query-embed
    // paths, so copy keyed off it would name a cause we don't have. The real one
    // rides in `detail`.
    const magnitude = error.staleCount != null ? ` (${error.staleCount} rows)` : ''
    return {
      content: t('reader:systemEntry.failure.embed'),
      detail: `${error.reason}: ${error.detail}${magnitude}`,
    }
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

// components/story-settings/memory-panel.tsx is the swap dialog's only mount
// host, so the action has to route there — opened from the reader alone, the
// dialog has nowhere to render.
export function useEmbedderFixAction(storyId: string | null): SystemEntryFixAction {
  const router = useRouter()
  if (storyId === null) return undefined
  return {
    label: t('reader:systemEntry.switchEmbedder'),
    onPress: () => {
      router.navigate(`/story-settings/${storyId}?tab=memory`)
      openEmbedderSwapDialog(storyId)
    },
  }
}

export function useSystemEntryActions(
  failure: SystemFailureMeta | undefined,
  onRetry: () => void,
  storyId: string | null,
): { onRetry: () => void; fixAction: SystemEntryFixAction } {
  const configFix = useConfigFixAction(
    failure?.kind === 'config-resolver' ? failure.failure : undefined,
  )
  const embedderFix = useEmbedderFixAction(failure?.kind === 'embedder' ? storyId : null)
  // The two gates are kind-exclusive, so the `??` order carries no meaning.
  return { onRetry, fixAction: embedderFix ?? configFix }
}
