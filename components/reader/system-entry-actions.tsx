import { useRouter } from 'expo-router'
import { useMemo } from 'react'

import { MANUAL_CLOSE_REFUSAL, type OwedCloseRun } from '@/lib/actions'
import {
  STORY_OVERRIDE_TARGETS,
  type CapabilityHint,
  type ContextWindowFailure,
  type ReplyCutOffFailure,
  type ResolveFailureKind,
  type StoryOverrideTarget,
} from '@/lib/ai'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import type { StorySettings, SystemFailureMeta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { EMBEDDER_SWAP_REFUSAL } from '@/lib/embedder-swap'
import { t } from '@/lib/i18n'
import {
  CHAPTER_CLOSE_KIND,
  CLASSIFIER_HELD,
  EMPTY_REPLY,
  PER_TURN_KIND,
  pipelineErrorDetail,
  type ConfigFailureKind,
  type PipelineError,
  type RejectedStart,
  type TxResult,
} from '@/lib/pipeline'
import { openEmbedderSwapDialog } from '@/lib/stores'
import { toast } from '@/lib/toast'

import { keptSubmissionText } from './composer-draft'
import {
  capabilityHintContent,
  closeContextWindowContent,
  passContextWindowContent,
  turnContextWindowContent,
} from './context-window-copy'
import {
  closeCutOffContent,
  offersProfileFix,
  passCutOffContent,
  turnCutOffContent,
} from './cut-off-copy'
import type { PassRefusal } from './send-run'

export type SystemEntryFixAction = { label: string; onPress: () => void } | undefined

type LeaveStory = (proceed: () => void) => void

type DismissDeps = {
  branchId: string
  submission: SystemFailureMeta['submission']
  beginDispatch: () => boolean
  endDispatch: () => void
  clear: () => Promise<void>
  stillOnBranch: () => boolean
  handBack: (submission: SystemFailureMeta['submission']) => void
}

async function clearedOrToasted(deps: DismissDeps): Promise<boolean> {
  try {
    await deps.clear()
    return true
  } catch (error: unknown) {
    logger.error('reader.system_entry_dismiss_failed', {
      branchId: deps.branchId,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(t('reader:systemEntry.dismissFailed'))
    return false
  }
}

/**
 * Hands the draft back only once the entry is gone (a composer copy beside Retry would run the turn
 * twice); off-branch it's dropped with a warning. A dispatch, so no Retry or Send runs under the
 * delete. Never rejects: the card fires it unawaited and on native a rejection dies in the WebView.
 */
export async function dismissSystemEntry(deps: DismissDeps): Promise<void> {
  const { branchId } = deps
  if (!deps.beginDispatch()) {
    logger.warn('reader.system_entry_dismiss_suppressed', { branchId })
    return
  }
  try {
    if (!(await clearedOrToasted(deps))) return
    if (deps.stillOnBranch()) deps.handBack(deps.submission)
    else if (keptSubmissionText(deps.submission) != null)
      logger.warn('reader.handback_skipped_left_branch', { branchId, source: 'dismiss' })
  } finally {
    deps.endDispatch()
  }
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

// Only a close's pre-flight raises 'tool-calling-off', so the close's set alone words it.
const CLOSE_RESOLVER_COPY = {
  'no-profile-assigned': 'reader:systemEntry.failure.closeNoProfileAssigned',
  'profile-missing': 'reader:systemEntry.failure.closeProfileMissing',
  'provider-missing': 'reader:systemEntry.failure.closeProviderMissing',
  'override-provider-missing': 'reader:systemEntry.failure.closeOverrideProviderMissing',
  'tool-calling-off': 'reader:systemEntry.failure.closeToolCallingOff',
} as const satisfies Record<ConfigFailureKind, string>

const FIX_PROFILE = 'reader:systemEntry.fixProfile'

const FIX_LABEL = {
  'no-profile-assigned': 'reader:systemEntry.assignProfile',
  'profile-missing': FIX_PROFILE,
  'provider-missing': 'reader:systemEntry.fixDefault',
  'override-provider-missing': 'reader:systemEntry.fixOverride',
  'tool-calling-off': FIX_PROFILE,
} as const satisfies Record<ConfigFailureKind, string>

const PROVIDER_SETTINGS_ROUTE = '/settings?tab=providers'

// The story's Models tab, where an override and its settings live. It's inside the story, so it
// takes no story-leave guard.
function storyOverrideRoute(storyId: string): `/story-settings/${string}?tab=models` {
  return `/story-settings/${storyId}?tab=models`
}

function isConfigFailureKind(failure: string): failure is ConfigFailureKind {
  return Object.hasOwn(FIX_LABEL, failure)
}

// The tags a provider hint persists; keyed per capability, so a new one is a type error until listed.
const HINT_FIX_TAGS = {
  reasoning: true,
  structuredOutput: true,
  toolCalling: true,
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

// The agent an error names, kept so a fix follows that slot rather than one guessed from the entry.
function failureTargetOf(error: PipelineError | undefined): string | undefined {
  if (
    error?.kind === 'config-resolver' ||
    error?.kind === 'reply-cut-off' ||
    error?.kind === 'context-window'
  )
    return error.target
  return undefined
}

function failureMetaOf(
  error: PipelineError | undefined,
  detail: string | undefined,
  submission: SystemFailureMeta['submission'],
): SystemFailureMeta {
  const failure = failureTagOf(error)
  const target = failureTargetOf(error)
  // A turn refused over its window keeps the refused prompt by section for its Details.
  const promptSections = error?.kind === 'context-window' ? error.promptSections : undefined
  return {
    kind: error?.kind ?? 'orchestrator',
    ...(failure != null ? { failure } : {}),
    ...(detail != null ? { detail } : {}),
    ...(target != null ? { target } : {}),
    ...(submission != null ? { submission } : {}),
    ...(promptSections != null ? { promptSections } : {}),
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
          ? capabilityHintContent(hint, 'turn', error.fromOverride)
          : t('reader:systemEntry.failure.llmCall'),
      detail: providerDetail(error),
    }
  }
  if (error?.kind === 'config-resolver') {
    // A turn's entry never words 'tool-calling-off'; only a close's pre-flight raises it.
    const key =
      error.failure === 'tool-calling-off'
        ? 'reader:systemEntry.failureMessage'
        : TURN_RESOLVER_COPY[error.failure]
    return { content: t(key), detail: error.detail }
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

type ResolverCopyKey =
  | (typeof PASS_RESOLVER_COPY)[ResolveFailureKind]
  | (typeof CLOSE_RESOLVER_COPY)[ConfigFailureKind]

// The words a failure entry for a Send's owed work speaks in; one arm serves pass and close.
type WorkerVocabulary = {
  generic: 'reader:systemEntry.failure.memory' | 'reader:systemEntry.failure.close'
  /** A kind this set doesn't word, as the pass's 'tool-calling-off', takes `generic`. */
  resolver: Readonly<Record<ResolveFailureKind, ResolverCopyKey>> &
    Readonly<Partial<Record<'tool-calling-off', ResolverCopyKey>>>
  hint: 'pass' | 'close'
  cutOff: (failure: ReplyCutOffFailure) => string
  window: (failure: ContextWindowFailure) => string
}

// The pass's own vocabulary (classifier.md → Failure policy): a turn's copy names the narrative
// agent, which would send the user to fix the wrong profile.
const PASS_VOCABULARY: WorkerVocabulary = {
  generic: 'reader:systemEntry.failure.memory',
  resolver: PASS_RESOLVER_COPY,
  hint: 'pass',
  cutOff: passCutOffContent,
  window: passContextWindowContent,
}

// The close's own vocabulary: it runs on lore-mgmt, which the pass's copy doesn't name.
const CLOSE_VOCABULARY: WorkerVocabulary = {
  generic: 'reader:systemEntry.failure.close',
  resolver: CLOSE_RESOLVER_COPY,
  hint: 'close',
  cutOff: closeCutOffContent,
  window: closeContextWindowContent,
}

function describeWorkerFailure(
  error: PipelineError,
  vocabulary: WorkerVocabulary,
): { content: string; detail?: string } {
  if (error.kind === 'provider') {
    const hint = error.possibleCapabilityMismatch
    return {
      content:
        hint !== undefined
          ? capabilityHintContent(hint, vocabulary.hint, error.fromOverride)
          : t(vocabulary.generic),
      detail: providerDetail(error),
    }
  }
  if (error.kind === 'config-resolver') {
    // Only the close's can't-call-tools line reads `model`.
    const key = vocabulary.resolver[error.failure] ?? vocabulary.generic
    return { content: t(key, { model: error.modelId }), detail: error.detail }
  }
  if (error.kind === 'reply-cut-off') {
    return { content: vocabulary.cutOff(error), detail: pipelineErrorDetail(error) }
  }
  if (error.kind === 'context-window') {
    return { content: vocabulary.window(error), detail: pipelineErrorDetail(error) }
  }
  return { content: t(vocabulary.generic), detail: pipelineErrorDetail(error) }
}

export function describePassFailure(refusal: PassRefusal): { content: string; detail?: string } {
  if (refusal.held) return { content: t('reader:systemEntry.failure.memoryHeld') }
  return describeWorkerFailure(refusal.error, PASS_VOCABULARY)
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

// What refuses a pass or a close while another run holds the story: a running kind, and the
// close's own busy check. A prose reversal is no run, so it takes the entry's own line.
const RUN_BLOCKERS: ReadonlySet<string> = new Set([
  MANUAL_CLOSE_REFUSAL.busy,
  PER_TURN_KIND,
  PERIODIC_CLASSIFIER_KIND,
  CHAPTER_CLOSE_KIND,
])

/** A refused Retry's or manual start's toast names the user's remedy, never the code. */
export function retryRefusalText(
  blockedBy: string,
  ownLine: 'reader:systemEntry.passRetryBlocked' | 'reader:systemEntry.closeRetryBlocked',
): string {
  if (blockedBy === EMBEDDER_SWAP_REFUSAL) return t('reader:actions.blockedWhileSwapping')
  if (RUN_BLOCKERS.has(blockedBy)) return t('reader:actions.blockedWhileGenerating')
  return t(ownLine)
}

/**
 * A pass-failure entry's Retry: runs the pass alone. A commit settles the entry through
 * `committed`; a failure, a throw or a hold rewrites it, a failure as held when its reversal didn't
 * commit; a cancel leaves the entry as it was, and any other refusal leaves it too, told through
 * `notify`. A throw from `held`, `committed` or `rewrite` propagates.
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
  // The toast names a remedy, never the code, so the code is kept here.
  logger.debug('reader.pass_retry_rejected', { blockedBy: result.blockedBy })
  if (result.blockedBy === CLASSIFIER_HELD) return deps.rewrite({ held: true })
  deps.notify(retryRefusalText(result.blockedBy, 'reader:systemEntry.passRetryBlocked'))
}

// A close has no held state, so there is no held arm.
export function describeCloseFailure(error: PipelineError): {
  content: string
  detail?: string
} {
  return describeWorkerFailure(error, CLOSE_VOCABULARY)
}

export function toCloseFailureMeta(
  error: PipelineError,
  submission: SystemFailureMeta['submission'],
): SystemFailureMeta {
  const { detail } = describeCloseFailure(error)
  return { ...failureMetaOf(error, detail, submission), close: 'failed' }
}

/** How a close Retry settled: its own close committed, or none was owed any more. */
export type CloseResolvedArm = 'closed' | 'nothing-owed'

/**
 * What a Retry that settled the close leaves when the composer can't take the entry's text back,
 * as `passResolvedEntry`: a notice holding the text, Dismiss alone, saying which way the Retry
 * settled. Else the entry clears.
 */
export function closeResolvedEntry(
  submission: NonNullable<SystemFailureMeta['submission']>,
  arm: CloseResolvedArm,
): {
  content: string
  failure: SystemFailureMeta
} {
  return {
    content: t(
      arm === 'closed'
        ? 'reader:systemEntry.closeResolvedTextKept'
        : 'reader:systemEntry.closeNothingOwedTextKept',
    ),
    failure: { kind: 'orchestrator', submission, close: 'resolved' },
  }
}

/**
 * A close-failure entry's Retry: runs what the close owes, catch-up passes first, or for a failed
 * click's entry its pick through the manual start. Committed or nothing owed settles via
 * `committed`, told which, as does a pick that can no longer end a chapter; a failed close
 * rewrites the entry, a failed catch-up pass or a held branch as a memory entry; a pick's failed
 * pre-flight rewrites it keeping the pick; a cancel, a chain ending before the close, or any other
 * refusal leaves it, the refusal told through `notify`. A run's throw rewrites the entry as an
 * `orchestrator` close failure, keeping any pick; throws from `held`, `committed` and the rewrites
 * propagate.
 */
export async function retryCloseEntry(deps: {
  runClose: () => Promise<OwedCloseRun>
  /** A failed click's end entry (`SystemFailureMeta.closePick`): Retry restarts that pick. */
  closePick: string | undefined
  runPicked: (endEntryId: string) => Promise<OwedCloseRun>
  /** Read once the run ended: whether the branch is held `running`. */
  held: () => Promise<boolean>
  committed: (arm: CloseResolvedArm) => Promise<void>
  /** With `closePick`, the rewritten entry keeps it. */
  rewriteClose: (error: PipelineError, closePick?: string) => Promise<void>
  rewritePass: (refusal: PassRefusal) => Promise<void>
  notify: (message: string) => void
}): Promise<void> {
  let run: OwedCloseRun
  try {
    run = await (deps.closePick == null ? deps.runClose() : deps.runPicked(deps.closePick))
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // A fresh restart validates the pick again, even when the throw came after the reserve.
    return deps.rewriteClose({ kind: 'orchestrator', detail }, deps.closePick)
  }
  // A pick closed into a chapter or deleted since leaves no close owed.
  const stalePick =
    deps.closePick != null &&
    run.outcome === 'rejected' &&
    run.blockedBy === MANUAL_CLOSE_REFUSAL.invalidEnd
  if (run.outcome === 'nothing-owed' || stalePick) return deps.committed('nothing-owed')
  // Nothing started, so the pick is still the entry's alone; once a run reserves, it is the
  // branch's pendingClose, and a failed run's entry drops it (the owed close's Retry serves it).
  if (run.outcome === 'preflight-failed') return deps.rewriteClose(run.error, deps.closePick)
  if (run.outcome === 'rejected') {
    logger.debug('reader.close_retry_rejected', { blockedBy: run.blockedBy })
    if (run.blockedBy === CLASSIFIER_HELD) return deps.rewritePass({ held: true })
    deps.notify(retryRefusalText(run.blockedBy, 'reader:systemEntry.closeRetryBlocked'))
    return
  }
  const { kind, result } = run.end
  if (kind === CHAPTER_CLOSE_KIND) {
    // A Cancel that landed after the close's last phase still left its chapter committed.
    if (result.outcome === 'completed') return deps.committed('closed')
    if (result.outcome === 'failed') return deps.rewriteClose(result.error)
    return
  }
  // The chain ended on a catch-up pass, so the close never ran and stays owed.
  if (result.outcome !== 'failed') return
  return deps.rewritePass(
    (await deps.held()) ? { held: true } : { held: false, error: result.error },
  )
}

// Shared by the bubble (Retry beside the fix) and the suggestion strip (fix alone). Widened past
// ConfigFailureKind: the bubble reads a persisted `z.string()`; unknown values get "Fix default".
export function useConfigFixAction(
  failure: ConfigFailureKind | (string & {}) | undefined,
  storyId: string | null,
  /** App Settings is outside the story, so the push waits on the host's story-leave guard. */
  leaveStory: LeaveStory,
  /** The story overrides the failure's slot now: a `Fix profile` follows it to the Models tab. */
  overridden = false,
): SystemEntryFixAction {
  const router = useRouter()
  if (failure === undefined) return undefined
  const toOverride = (id: string): SystemEntryFixAction => ({
    label: t(FIX_LABEL['override-provider-missing']),
    onPress: () => router.navigate(storyOverrideRoute(id)),
  })
  // The override carries its own provider, so App Settings shows a healthy chain
  // and nothing to repair; the row with the `×` is on this story's Models tab.
  if (failure === 'override-provider-missing')
    return storyId === null ? undefined : toOverride(storyId)
  // Every `Fix profile` follows the slot's settings to the story's override when there is one now
  // (generation-pipeline.md → Cut-off replies → Whose setting it was).
  if (
    overridden &&
    storyId !== null &&
    isConfigFailureKind(failure) &&
    FIX_LABEL[failure] === FIX_PROFILE
  )
    return toOverride(storyId)
  return {
    label: t(isConfigFailureKind(failure) ? FIX_LABEL[failure] : 'reader:systemEntry.fixDefault'),
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

const STORY_SLOTS: ReadonlySet<string> = new Set(STORY_OVERRIDE_TARGETS)

function isStorySlot(target: string | undefined): target is StoryOverrideTarget {
  return target !== undefined && STORY_SLOTS.has(target)
}

/**
 * The slot whose settings a failure entry's fix points at: the target its error named, else, for an
 * entry written without one or an error that names none (a capability hint), a pass's classifier,
 * a close's lore-mgmt and any other entry's narrative.
 */
export function profileFixSlot(failure: SystemFailureMeta | undefined): StoryOverrideTarget {
  if (isStorySlot(failure?.target)) return failure.target
  if (failure?.close !== undefined) return 'lore-mgmt'
  if (failure?.pass !== undefined) return 'classifier'
  return 'narrative'
}

/**
 * `Fix profile` via the story-leave guard, or `Fix story override` to the Models tab when the story
 * overrides the slot now, whoever's setting the failure named (generation-pipeline.md → Cut-off
 * replies → Whose setting it was). Memoized: the reader hands it to every row, so a fresh identity
 * would re-render each per chunk.
 */
export function useProfileFixAction(
  enabled: boolean,
  overridden: boolean,
  storyId: string | null,
  leaveStory: LeaveStory,
): SystemEntryFixAction {
  const router = useRouter()
  return useMemo(() => {
    if (!enabled) return undefined
    if (overridden && storyId !== null)
      return {
        label: t('reader:systemEntry.fixOverride'),
        onPress: () => router.navigate(storyOverrideRoute(storyId)),
      }
    return {
      label: t('reader:systemEntry.fixProfile'),
      onPress: () => leaveStory(() => router.push(PROVIDER_SETTINGS_ROUTE)),
    }
  }, [enabled, overridden, storyId, leaveStory, router])
}

export function useSystemEntryActions(
  failure: SystemFailureMeta | undefined,
  onRetry: () => void,
  storyId: string | null,
  leaveStory: LeaveStory,
  /** The open story's overrides as they stand now, which a profile fix follows. */
  storyModels: StorySettings['models'] | undefined,
): { onRetry: (() => void) | undefined; fixAction: SystemEntryFixAction } {
  const overridden = storyModels?.[profileFixSlot(failure)] != null
  const configFix = useConfigFixAction(
    failure?.kind === 'config-resolver' ? failure.failure : undefined,
    storyId,
    leaveStory,
    overridden,
  )
  const embedderFix = useEmbedderFixAction(failure?.kind === 'embedder' ? storyId : null)
  // None for context-window: `Set window` needs App Settings' window editor and a model target.
  const profileFix = useProfileFixAction(
    (failure?.kind === 'reply-cut-off' && offersProfileFix(failure.failure)) ||
      (failure?.kind === 'provider' && isCapabilityHintTag(failure.failure)),
    overridden,
    storyId,
    leaveStory,
  )
  // A held branch can't run a pass, and a resolved entry has nothing left to retry, so either
  // offers Dismiss alone. The fix gates are kind-exclusive, so the `??` order carries no meaning.
  const retryWithheld =
    failure?.pass === 'held' || failure?.pass === 'resolved' || failure?.close === 'resolved'
  return {
    onRetry: retryWithheld ? undefined : onRetry,
    fixAction: embedderFix ?? configFix ?? profileFix,
  }
}
