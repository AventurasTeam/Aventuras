import { useCallback } from 'react'

import type { GenerationPhase } from '@/components/compounds/generation-status-pill'
import { CHAPTER_CLOSE_KIND, CHAPTER_CLOSE_RERUN } from '@/lib/chapters'
import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { t } from '@/lib/i18n'
import { PER_TURN_KIND, SUGGESTION_REFRESH_KIND } from '@/lib/pipeline'
import {
  awaitRunTerminal,
  generationStore,
  interruptMemoryRuns,
  isBranchHeld,
  isUserEditBlocked,
  RERUN_HELD,
  runBlocksHeadReversal,
  type RunState,
  type TxState,
} from '@/lib/stores'

type StorySettingsGenerationPhase =
  | 'generating-narrative'
  | 'closing-chapter'
  | 'refreshing-suggestions'
  | 'updating-memory'

type PillScope = { storyId: string | undefined; branchId?: string }

/**
 * The one run the pill names, so its Cancel ends that run; a pass or close owns the pill over a
 * refresh beside it. `branchId` narrows the pick to that branch.
 */
function pillRun(txState: TxState, scope: PillScope): RunState | undefined {
  return firstByPillOrder(
    [...txState.runs.values()].filter(
      (run) =>
        run.storyId === scope.storyId &&
        (scope.branchId == null || run.branchId === scope.branchId),
    ),
  )
}

function firstByPillOrder(runs: readonly RunState[]): RunState | undefined {
  return (
    runs.find((run) => run.kind === PER_TURN_KIND) ??
    runs.find((run) => run.interruptible) ??
    runs.find((run) => run.gateBehavior === 'hard-gate' && run.kind !== SUGGESTION_REFRESH_KIND) ??
    runs.find((run) => run.kind === SUGGESTION_REFRESH_KIND)
  )
}

/** The kind a run's tooltips and pill name: a re-run is a close by kind, told apart by its slot. */
export function runGateKind(run: Pick<RunState, 'kind' | 'interruptible'>): string {
  return run.interruptible === 'rerun' ? CHAPTER_CLOSE_RERUN : run.kind
}

function gateKindOf(run: RunState | undefined): string | null {
  return run == null ? null : runGateKind(run)
}

/** @returns The gate kind of the pill's run across the story, or null when no run covers it. */
export function selectStorySettingsGenerationRunKind(
  txState: TxState,
  storyId: string | undefined,
): string | null {
  return gateKindOf(pillRun(txState, { storyId }))
}

/**
 * The gate kind of the run a head reversal on `branchId` waits on; beside a pass it isn't the
 * pill's (a pass lets it through, a refresh doesn't). Null when no run holds that gate; a pending
 * turn or a reversal's sweep may still close it.
 */
export function selectHeadReversalRunKind(txState: TxState, branchId: string): string | null {
  return gateKindOf(
    firstByPillOrder(
      [...txState.runs.values()].filter((run) => runBlocksHeadReversal(run, branchId)),
    ),
  )
}

/** A hold until restart on the scope's branch, or on any branch of its story when it names none. */
export function selectGateHeld(txState: TxState, scope: PillScope): boolean {
  if (scope.branchId != null) return isBranchHeld(txState, scope.branchId)
  for (const held of txState.heldBranches.values()) if (held.storyId === scope.storyId) return true
  return false
}

/** A re-run on `branchId`: refuses CTRL-Z while it runs; with a row's chapter id it is
 * `rerunHoldsReversal`, which the reader document can't read itself. */
export function selectRerunRunning(txState: TxState, branchId: string): boolean {
  for (const run of txState.runs.values())
    if (run.branchId === branchId && run.interruptible === 'rerun') return true
  return false
}

function cancelPillRunIn(scope: PillScope): void {
  const run = pillRun(generationStore.getTxState(), scope)
  if (run == null) return
  if (run.interruptible) void interruptMemoryRuns(run.branchId)
  else void awaitRunTerminal(run.kind, run.branchId, 'cancel')
}

/** Why an in-story edit is blocked right now, or undefined when it isn't. */
export function generationGateReason(editBlocked: true, runKind: string | null): string
export function generationGateReason(
  editBlocked: boolean,
  runKind: string | null,
): string | undefined
export function generationGateReason(
  editBlocked: boolean,
  runKind: string | null,
): string | undefined {
  if (!editBlocked) return undefined
  if (runKind === PERIODIC_CLASSIFIER_KIND) return t('generationGate.updatingMemory')
  if (runKind === CHAPTER_CLOSE_KIND) return t('generationGate.chapterClose')
  if (runKind === CHAPTER_CLOSE_RERUN) return t('generationGate.chapterCloseRerun')
  if (runKind === SUGGESTION_REFRESH_KIND) return t('generationGate.suggestionRefresh')
  if (runKind === RERUN_HELD) return t('generationGate.rerunHeld')
  return t('generationGate.inFlight')
}

/**
 * Why a head reversal is blocked: the run it can't interrupt, else the pill's — a dispatch or a
 * sweep can hold head reversals while the only run is one they would otherwise pass through.
 */
export function headReversalGateReason(
  blocked: boolean,
  runKinds: { headReversal: string | null; pill: string | null },
): string | undefined {
  return generationGateReason(blocked, runKinds.headReversal ?? runKinds.pill)
}

/** `branchId` scopes the pill's run to that branch (World, Plot); omitted, to the story. */
export function useStoryGenerationGate(
  storyId: string | undefined,
  branchId?: string,
): {
  /** The pill's run by its gate kind (`runGateKind`). */
  activeRunKind: string | null
  editBlocked: boolean
  gateReason: string | undefined
  beforeTurn: boolean
  /** Ends the pill's run; an interruptible one defers to the next Send, a re-run defers nothing. */
  cancelPillRun: () => void
} {
  const activeRunKind = generationStore.useGeneration((s) =>
    gateKindOf(pillRun(s.txState, { storyId, branchId })),
  )
  const beforeTurn = generationStore.useGeneration(
    (s) => pillRun(s.txState, { storyId, branchId })?.beforeTurn ?? false,
  )
  const held = generationStore.useGeneration((s) =>
    selectGateHeld(s.txState, { storyId, branchId }),
  )
  const editBlocked = generationStore.useGeneration((s) => isUserEditBlocked(s.txState)) || held
  const gateReason = generationGateReason(editBlocked, held ? RERUN_HELD : activeRunKind)
  const cancelPillRun = useCallback(
    () => cancelPillRunIn({ storyId, branchId }),
    [storyId, branchId],
  )
  return { activeRunKind, editBlocked, gateReason, beforeTurn, cancelPillRun }
}

export function storySettingsGenerationPhase(kind: string): StorySettingsGenerationPhase {
  if (kind === PERIODIC_CLASSIFIER_KIND) return 'updating-memory'
  if (kind === CHAPTER_CLOSE_KIND || kind === CHAPTER_CLOSE_RERUN) return 'closing-chapter'
  if (kind === SUGGESTION_REFRESH_KIND) return 'refreshing-suggestions'
  return 'generating-narrative'
}

/** The status pill's phase for the pill's run, or undefined when no run covers the screen. */
export function storyPillPhase(activeRunKind: string | null): GenerationPhase | undefined {
  return activeRunKind == null ? undefined : storySettingsGenerationPhase(activeRunKind)
}

export type { StorySettingsGenerationPhase }
