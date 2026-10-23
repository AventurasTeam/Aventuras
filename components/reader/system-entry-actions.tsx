import { useRouter } from 'expo-router'

import type { ResolveFailureKind } from '@/lib/ai'
import type { SystemFailureMeta } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  CLASSIFIER_HELD,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { openEmbedderSwapDialog } from '@/lib/stores'

import type { PassRefusal } from './send-run'

export type SystemEntryFixAction = { label: string; onPress: () => void } | undefined

type LeaveStory = (proceed: () => void) => void

/**
 * Hand the draft back only once the entry is gone: a rejected clear keeps Retry, and a
 * composer copy would run the turn twice. Off-branch, the hand-back is dropped, not pasted.
 */
export async function dismissSystemEntry(deps: {
  submission: SystemFailureMeta['submission']
  clear: () => Promise<void>
  reload: () => Promise<void>
  stillOnBranch: () => boolean
  handBack: (submission: SystemFailureMeta['submission']) => void
}): Promise<void> {
  await deps.clear()
  await deps.reload()
  if (deps.stillOnBranch()) deps.handBack(deps.submission)
}

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
          : error.failure === 'override-provider-missing'
            ? 'reader:systemEntry.failure.overrideProviderMissing'
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

// The pass's own vocabulary (classifier.md → Failure policy): a turn's copy names the narrative
// agent, which would send the user to fix the wrong profile.
export function describePassFailure(refusal: PassRefusal): { content: string; detail?: string } {
  if (refusal.held) return { content: t('reader:systemEntry.failure.memoryHeld') }
  const { error } = refusal
  if (error?.kind === 'config-resolver') {
    const contentKey =
      error.failure === 'no-profile-assigned'
        ? 'reader:systemEntry.failure.memoryNoProfileAssigned'
        : error.failure === 'profile-missing'
          ? 'reader:systemEntry.failure.memoryProfileMissing'
          : error.failure === 'override-provider-missing'
            ? 'reader:systemEntry.failure.memoryOverrideProviderMissing'
            : 'reader:systemEntry.failure.memoryProviderMissing'
    return { content: t(contentKey), detail: error.detail }
  }
  const detail =
    error?.kind === 'provider'
      ? error.detail != null
        ? `${error.reason}: ${error.detail}`
        : error.reason
      : error?.detail
  return { content: t('reader:systemEntry.failure.memory'), detail }
}

export function toPassFailureMeta(
  refusal: PassRefusal,
  submission: { content: string; composerMode: string } | undefined,
): SystemFailureMeta {
  const error = refusal.held ? undefined : refusal.error
  const { detail } = describePassFailure(refusal)
  return {
    kind: error?.kind ?? 'orchestrator',
    ...(error?.kind === 'config-resolver' ? { failure: error.failure } : {}),
    ...(detail != null ? { detail } : {}),
    ...(submission != null ? { submission } : {}),
    pass: refusal.held ? 'held' : 'failed',
  }
}

/**
 * A pass-failure entry's Retry: runs the pass alone. A commit clears the entry through `dismiss`;
 * a failure, a throw or a hold rewrites it; a cancel leaves it to the deferral toast. A throw from
 * `dismiss` or `rewrite` propagates.
 */
export async function retryPassEntry(deps: {
  runPass: () => Promise<TxResult | RejectedStart>
  dismiss: () => Promise<void>
  rewrite: (refusal: PassRefusal) => Promise<void>
  notify: (message: string) => void
}): Promise<void> {
  let result: TxResult | RejectedStart
  try {
    result = await deps.runPass()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return deps.rewrite({ held: false, error: { kind: 'orchestrator', detail } })
  }
  if (result.outcome === 'completed') return deps.dismiss()
  if (result.outcome === 'failed') return deps.rewrite({ held: false, error: result.error })
  if (result.outcome !== 'rejected') return
  if (result.blockedBy === CLASSIFIER_HELD) return deps.rewrite({ held: true })
  deps.notify(t('reader:systemEntry.passRetryBlocked', { reason: result.blockedBy }))
}

// Shared by the system-entry bubble and the suggestion strip: a config-resolver
// failure is deterministic, so both surfaces route to settings instead of
// offering a retry that cannot succeed. Widened past ResolveFailureKind because
// the bubble's caller reads a persisted `z.string()`; an unrecognised value
// lands on the generic "Fix default" rather than dropping the affordance.
export function useConfigFixAction(
  failure: ResolveFailureKind | (string & {}) | undefined,
  storyId: string | null,
  /** App Settings is outside the story, so the push waits on the host's story-leave guard. */
  leaveStory: LeaveStory,
): SystemEntryFixAction {
  const router = useRouter()
  if (failure === undefined) return undefined
  // The override carries its own provider, so App Settings shows a healthy chain
  // and nothing to repair; the row with the `×` is on this story's Models tab.
  if (failure === 'override-provider-missing') {
    if (storyId === null) return undefined
    return {
      label: t('reader:systemEntry.fixOverride'),
      onPress: () => router.navigate(`/story-settings/${storyId}?tab=models`),
    }
  }
  const labelKey =
    failure === 'no-profile-assigned'
      ? 'reader:systemEntry.assignProfile'
      : failure === 'profile-missing'
        ? 'reader:systemEntry.fixProfile'
        : 'reader:systemEntry.fixDefault'
  return {
    label: t(labelKey),
    onPress: () => leaveStory(() => router.push('/settings?tab=providers')),
  }
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
  leaveStory: LeaveStory,
): { onRetry: (() => void) | undefined; fixAction: SystemEntryFixAction } {
  const configFix = useConfigFixAction(
    failure?.kind === 'config-resolver' ? failure.failure : undefined,
    storyId,
    leaveStory,
  )
  const embedderFix = useEmbedderFixAction(failure?.kind === 'embedder' ? storyId : null)
  // A held branch can't run a pass, so its entry offers Dismiss alone. The two fix gates are
  // kind-exclusive, so the `??` order carries no meaning.
  return {
    onRetry: failure?.pass === 'held' ? undefined : onRetry,
    fixAction: embedderFix ?? configFix,
  }
}
