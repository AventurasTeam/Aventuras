import { useRouter } from 'expo-router'
import { useMemo } from 'react'

import type { CapabilityHint, ResolveFailureKind } from '@/lib/ai'
import type { SystemFailureMeta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import {
  CLASSIFIER_HELD,
  EMPTY_REPLY,
  pipelineErrorDetail,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { openEmbedderSwapDialog } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { keptSubmissionText } from './composer-draft'
import {
  capabilityHintContent,
  passContextWindowContent,
  turnContextWindowContent,
} from './context-window-copy'
import { offersProfileFix, passCutOffContent, turnCutOffContent } from './cut-off-copy'
import type { PassRefusal } from './send-run'

export type SystemEntryFixAction = { label: string; onPress: () => void } | undefined

type LeaveStory = (proceed: () => void) => void

/**
 * Hand the draft back only once the entry is gone (a rejected clear keeps Retry; a composer copy
 * would run the turn twice), even if reload rejects. Off-branch it's dropped with a warning. Settles
 * rather than rejects: the card fires this unawaited, and on native a rejection dies in the WebView.
 */
export async function dismissSystemEntry(deps: {
  branchId: string
  submission: SystemFailureMeta['submission']
  clear: () => Promise<void>
  reload: () => Promise<void>
  stillOnBranch: () => boolean
  handBack: (submission: SystemFailureMeta['submission']) => void
}): Promise<void> {
  const { branchId } = deps
  try {
    await deps.clear()
  } catch (error: unknown) {
    logger.error('reader.system_entry_dismiss_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(t('reader:systemEntry.dismissFailed'))
    return
  }
  try {
    await deps.reload()
  } catch (error: unknown) {
    logger.error('reader.system_entry_reload_failed', {
      branchId,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(t('reader:systemEntry.dismissReloadFailed'))
  }
  if (deps.stillOnBranch()) deps.handBack(deps.submission)
  else if (keptSubmissionText(deps.submission) != null)
    logger.warn('reader.handback_skipped_left_branch', { branchId, source: 'dismiss' })
}

// Exhaustive per wording set: a new resolver kind is a type error, not another kind's copy.
const TURN_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:systemEntry.failure.noProfileAssigned',
  'profile-missing': 'reader:systemEntry.failure.profileMissing',
  'provider-missing': 'reader:systemEntry.failure.providerMissing',
  'override-provider-missing': 'reader:systemEntry.failure.overrideProviderMissing',
} as const satisfies Record<ResolveFailureKind, string>

const PASS_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:systemEntry.failure.memoryNoProfileAssigned',
  'profile-missing': 'reader:systemEntry.failure.memoryProfileMissing',
  'provider-missing': 'reader:systemEntry.failure.memoryProviderMissing',
  'override-provider-missing': 'reader:systemEntry.failure.memoryOverrideProviderMissing',
} as const satisfies Record<ResolveFailureKind, string>

const FIX_LABEL = {
  'no-profile-assigned': 'reader:systemEntry.assignProfile',
  'profile-missing': 'reader:systemEntry.fixProfile',
  'provider-missing': 'reader:systemEntry.fixDefault',
  'override-provider-missing': 'reader:systemEntry.fixOverride',
} as const satisfies Record<ResolveFailureKind, string>

const PROVIDER_SETTINGS_ROUTE = '/settings?tab=providers'

function isResolveFailureKind(failure: string): failure is ResolveFailureKind {
  return Object.hasOwn(FIX_LABEL, failure)
}

// The tags a provider hint persists; keyed per capability, so a new one is a type error until listed.
const HINT_FIX_TAGS = {
  reasoning: true,
  structuredOutput: true,
} as const satisfies Record<CapabilityHint['capability'], true>

function isCapabilityHintTag(failure: string | undefined): boolean {
  return failure !== undefined && Object.hasOwn(HINT_FIX_TAGS, failure)
}

function providerDetail(error: Extract<PipelineError, { kind: 'provider' }>): string {
  return error.detail != null ? `${error.reason}: ${error.detail}` : error.reason
}

// The persisted `failure` tag: resolver, cut-off and hinted provider entries pick their fix by it.
function failureTagOf(error: PipelineError | undefined): string | undefined {
  if (error?.kind === 'config-resolver') return error.failure
  if (error?.kind === 'reply-cut-off') return error.cause
  if (error?.kind === 'context-window') return error.detectedBy
  if (error?.kind === 'provider') return error.possibleCapabilityMismatch?.capability
  return undefined
}

function failureMetaOf(
  error: PipelineError | undefined,
  detail: string | undefined,
  submission: SystemFailureMeta['submission'],
): SystemFailureMeta {
  const failure = failureTagOf(error)
  return {
    kind: error?.kind ?? 'orchestrator',
    ...(failure != null ? { failure } : {}),
    ...(detail != null ? { detail } : {}),
    ...(submission != null ? { submission } : {}),
  }
}

// Per-kind bubble copy (reader-composer.md → Error surface), resolved at write
// time so the persisted entry keeps its vocabulary across an app restart.
export function describeTurnFailure(error: PipelineError | undefined): {
  content: string
  detail?: string
} {
  if (error?.kind === 'provider') {
    const hint = error.possibleCapabilityMismatch
    return {
      content:
        hint !== undefined
          ? capabilityHintContent(hint, 'turn')
          : t('reader:systemEntry.failure.llmCall'),
      detail: providerDetail(error),
    }
  }
  if (error?.kind === 'config-resolver') {
    return { content: t(TURN_RESOLVER_COPY[error.failure]), detail: error.detail }
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
  if (error?.kind === 'reply-cut-off') {
    return { content: turnCutOffContent(error), detail: pipelineErrorDetail(error) }
  }
  if (error?.kind === 'context-window') {
    return { content: turnContextWindowContent(error), detail: pipelineErrorDetail(error) }
  }
  if (error?.kind === 'phase-logic' && error.subsystem === EMPTY_REPLY) {
    return {
      content: t('reader:systemEntry.failure.emptyReply'),
      detail: pipelineErrorDetail(error),
    }
  }
  return {
    content: t('reader:systemEntry.failureMessage'),
    detail: error !== undefined ? pipelineErrorDetail(error) : undefined,
  }
}

export function toSystemFailureMeta(
  error: PipelineError | undefined,
  submission: { content: string; composerMode: string } | undefined,
): SystemFailureMeta {
  return failureMetaOf(error, describeTurnFailure(error).detail, submission)
}

// The pass's own vocabulary (classifier.md → Failure policy): a turn's copy names the narrative
// agent, which would send the user to fix the wrong profile.
export function describePassFailure(refusal: PassRefusal): { content: string; detail?: string } {
  if (refusal.held) return { content: t('reader:systemEntry.failure.memoryHeld') }
  const { error } = refusal
  if (error?.kind === 'provider') {
    const hint = error.possibleCapabilityMismatch
    return {
      content:
        hint !== undefined
          ? capabilityHintContent(hint, 'pass')
          : t('reader:systemEntry.failure.memory'),
      detail: providerDetail(error),
    }
  }
  if (error?.kind === 'config-resolver') {
    return { content: t(PASS_RESOLVER_COPY[error.failure]), detail: error.detail }
  }
  if (error?.kind === 'reply-cut-off') {
    return { content: passCutOffContent(error), detail: pipelineErrorDetail(error) }
  }
  if (error?.kind === 'context-window') {
    return { content: passContextWindowContent(error), detail: pipelineErrorDetail(error) }
  }
  return {
    content: t('reader:systemEntry.failure.memory'),
    detail: error !== undefined ? pipelineErrorDetail(error) : undefined,
  }
}

export function toPassFailureMeta(
  refusal: PassRefusal,
  submission: SystemFailureMeta['submission'],
): SystemFailureMeta {
  const error = refusal.held ? undefined : refusal.error
  const { detail } = describePassFailure(refusal)
  return { ...failureMetaOf(error, detail, submission), pass: refusal.held ? 'held' : 'failed' }
}

/**
 * What a committed Retry leaves when the composer couldn't take its entry's text back: a notice
 * holding the text, with no Retry and no fix, whose Dismiss hands the text back.
 */
export function passResolvedEntry(submission: NonNullable<SystemFailureMeta['submission']>): {
  content: string
  failure: SystemFailureMeta
} {
  return {
    content: t('reader:systemEntry.passResolvedTextKept'),
    failure: { kind: 'orchestrator', submission, pass: 'resolved' },
  }
}

/**
 * A pass-failure entry's Retry: runs the pass alone. A commit settles the entry through
 * `committed`; a failure, a throw or a hold rewrites it, a failure as held when its reversal didn't
 * commit; a cancel leaves the entry as it was. A throw from `held`, `committed` or `rewrite`
 * propagates.
 */
export async function retryPassEntry(deps: {
  runPass: () => Promise<TxResult | RejectedStart>
  /** Read once the pass ended: whether the branch is held `running`. */
  held: () => Promise<boolean>
  committed: () => Promise<void>
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
  if (result.outcome === 'completed') return deps.committed()
  if (result.outcome === 'failed')
    return deps.rewrite((await deps.held()) ? { held: true } : { held: false, error: result.error })
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
      label: t(FIX_LABEL['override-provider-missing']),
      onPress: () => router.navigate(`/story-settings/${storyId}?tab=models`),
    }
  }
  return {
    label: t(isResolveFailureKind(failure) ? FIX_LABEL[failure] : 'reader:systemEntry.fixDefault'),
    onPress: () => leaveStory(() => router.push(PROVIDER_SETTINGS_ROUTE)),
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

/**
 * `Fix profile` via the story-leave guard. Memoized: the reader hands it to every row, so a fresh
 * identity would re-render each per chunk.
 */
export function useProfileFixAction(
  enabled: boolean,
  leaveStory: LeaveStory,
): SystemEntryFixAction {
  const router = useRouter()
  return useMemo(
    () =>
      enabled
        ? {
            label: t('reader:systemEntry.fixProfile'),
            onPress: () => leaveStory(() => router.push(PROVIDER_SETTINGS_ROUTE)),
          }
        : undefined,
    [enabled, leaveStory, router],
  )
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
  // None for context-window: `Set window` needs App Settings' window editor and a model target.
  const profileFix = useProfileFixAction(
    (failure?.kind === 'reply-cut-off' && offersProfileFix(failure.failure)) ||
      (failure?.kind === 'provider' && isCapabilityHintTag(failure.failure)),
    leaveStory,
  )
  // A held branch can't run a pass, and a resolved entry's pass has run, so either offers Dismiss
  // alone. The fix gates are kind-exclusive, so the `??` order carries no meaning.
  return {
    onRetry: failure?.pass === 'held' || failure?.pass === 'resolved' ? undefined : onRetry,
    fixAction: embedderFix ?? configFix ?? profileFix,
  }
}
