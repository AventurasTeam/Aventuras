import { eq } from 'drizzle-orm'

import {
  DeltaReplayError,
  applyDeltaAction,
  reverseReplayDeltas,
  type DbCtx,
  type MutationResult,
} from '@/lib/actions'
import { pipelineRuns } from '@/lib/db'
import { logger, makeLogger, turnCaptureSink } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { appSettingsStore, generationStore, type RunState } from '@/lib/stores'

import { getPipeline } from '../authoring/registry'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseFn,
  PhaseNode,
  PhaseResult,
  PipelineError,
  RejectedStart,
  TxResult,
} from '../types'
import { checkConcurrencyContract } from './concurrency'
import { pipelineEventBus } from './event-bus'
import { runPreflight } from './preflight'

class ActionLayerError extends Error {
  readonly detail: string
  constructor(detail: string) {
    super(detail)
    this.name = 'ActionLayerError'
    this.detail = detail
  }
}

class ActionRejectedError extends ActionLayerError {
  constructor(reason: string) {
    super(reason)
    this.name = 'ActionRejectedError'
  }
}

export type RunCtx = { storyId: string | null; branchId: string } & DbCtx

function newRunState(kind: string, ctx: RunCtx): RunState {
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  return {
    runId: generateId('run'),
    kind,
    actionId: generateId('act'),
    storyId: ctx.storyId,
    branchId: ctx.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal,
    resolveTerminal,
  }
}

// Synchronous reservation: place the run in txState before any await, so the
// concurrency check that precedes it can't be raced by a second start of a
// mutually-blocking kind slipping in across an await boundary.
function reserveRun(kind: string, ctx: RunCtx): RunState {
  const run = newRunState(kind, ctx)
  generationStore.startRun(run)
  return run
}

async function beginRun(run: RunState, ctx: RunCtx): Promise<void> {
  try {
    await ctx.db.insert(pipelineRuns).values({
      runId: run.runId,
      kind: run.kind,
      actionId: run.actionId,
      storyId: ctx.storyId,
      startedAt: Date.now(),
    })
  } catch (e) {
    // Marker insert failed; unwind the synchronous reservation so a half-registered
    // run can't gate edits or hold the branch against a retry. Resolve terminal so a
    // waiter that grabbed it between reserve and failure isn't left hanging.
    generationStore.abortRun(run.runId)
    run.resolveTerminal()
    throw e
  }
  turnCaptureSink.beginTurn({ actionId: run.actionId, kind: run.kind, branchId: run.branchId })
  pipelineEventBus.emit({
    type: 'run_start',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
  })
}

// Generic wait on an in-flight run of `kind`, optionally aborting it first.
// No-op when none is running. 'cancel' fires abort then awaits terminal (the
// doomed call winds down); 'finish' awaits the natural commit. The waiter need
// not have started the run — it awaits the run's own terminal deferred.
export function awaitRunTerminal(kind: string, disposition: 'finish' | 'cancel'): Promise<void> {
  const run = [...generationStore.getTxState().runs.values()].find((r) => r.kind === kind)
  if (!run) return Promise.resolve()
  if (disposition === 'cancel') run.abortController.abort()
  return run.terminal
}

async function handleEvent(event: PhaseEmittedEvent, run: RunState, ctx: RunCtx): Promise<void> {
  if (event.type === 'delta_emitted') {
    let result: MutationResult
    try {
      result = await applyDeltaAction(
        {
          action: event.action,
          actionId: run.actionId,
          branchId: run.branchId,
          entryId: event.entryId ?? null,
        },
        ctx,
      )
    } catch (e) {
      // A throw from the action layer (e.g. a DB constraint) is an action-layer
      // failure, not an orchestrator bug — preserve the kind for diagnostics.
      throw new ActionLayerError(e instanceof Error ? e.message : String(e))
    }
    if (result.status === 'rejected') throw new ActionRejectedError(result.reason)
  } else if (event.type === 'recoverable_error') {
    logger.warn(
      'pipeline.recoverable_error',
      { detail: event.error.detail ?? event.error.kind },
      { actionId: run.actionId },
    )
  }
  // stream_chunk: side-channel; no UI consumer in M1.
  pipelineEventBus.emit(event)
}

async function consumePhase(
  gen: AsyncGenerator<PhaseEmittedEvent, PhaseResult>,
  run: RunState,
  ctx: RunCtx,
): Promise<PhaseResult> {
  for (;;) {
    const next = await gen.next()
    if (next.done) return next.value
    await handleEvent(next.value, run, ctx)
  }
}

function phaseContextOf(run: RunState): PhaseContext {
  return {
    actionId: run.actionId,
    abortSignal: run.abortController.signal,
    intermediates: run.intermediates,
    log: makeLogger(run.actionId),
  }
}

async function runParallelGroup(
  branches: readonly { name: string; run: PhaseFn }[],
  run: RunState,
  ctx: RunCtx,
): Promise<PhaseResult> {
  const results = await Promise.all(
    branches.map(async (b) => {
      pipelineEventBus.emit({ type: 'phase_start', runId: run.runId, name: b.name })
      const result = await consumePhase(b.run(phaseContextOf(run)), run, ctx)
      pipelineEventBus.emit({ type: 'phase_complete', runId: run.runId, name: b.name, result })
      if (result.status === 'failed') run.abortController.abort() // wind down siblings that poll
      return result
    }),
  )
  return (
    results.find((r) => r.status === 'failed') ??
    results.find((r) => r.status === 'aborted') ?? { status: 'completed' }
  )
}

async function runNode(node: PhaseNode, run: RunState, ctx: RunCtx): Promise<PhaseResult> {
  generationStore.setCurrentPhase(run.runId, node.name)
  turnCaptureSink.appendPhaseEvent(run.actionId, {
    phase: node.name,
    kind: 'enter',
    at: Date.now(),
  })
  pipelineEventBus.emit({ type: 'phase_start', runId: run.runId, name: node.name })
  const result =
    'parallel' in node
      ? await runParallelGroup(node.parallel, run, ctx)
      : await consumePhase(node.run(phaseContextOf(run)), run, ctx)
  turnCaptureSink.appendPhaseEvent(run.actionId, { phase: node.name, kind: 'exit', at: Date.now() })
  generationStore.recordPhaseResult(run.runId, node.name, result)
  pipelineEventBus.emit({ type: 'phase_complete', runId: run.runId, name: node.name, result })
  return result
}

async function startChainedSuccessor(run: RunState, ctx: RunCtx): Promise<void> {
  await ctx.db.insert(pipelineRuns).values({
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    storyId: ctx.storyId,
    startedAt: Date.now(),
  })
  turnCaptureSink.beginTurn({ actionId: run.actionId, kind: run.kind, branchId: run.branchId })
  pipelineEventBus.emit({
    type: 'run_start',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
  })
}

async function commitRun(
  run: RunState,
  ctx: RunCtx,
): Promise<{ tx: TxResult; successor?: RunState }> {
  const pipeline = getPipeline(run.kind)
  const nextKind = pipeline.chainsTo?.(run) ?? null
  const successor = nextKind ? newRunState(nextKind, ctx) : undefined
  generationStore.finishRun(run.runId, successor)
  try {
    await ctx.db
      .update(pipelineRuns)
      .set({ finishedAt: Date.now(), outcome: 'completed' })
      .where(eq(pipelineRuns.runId, run.runId))
  } catch (e) {
    // The run's writes already committed; a failed marker leaves an orphan that
    // boot recovery reconciles. Finish cleanly regardless.
    logger.error(
      'pipeline.marker_write_failed',
      { runId: run.runId, outcome: 'completed', error: String(e) },
      { actionId: run.actionId },
    )
  }
  turnCaptureSink.endTurn(run.actionId, 'completed')
  logger.debug(
    'pipeline.run_complete',
    { runId: run.runId, kind: run.kind, outcome: 'completed' },
    { actionId: run.actionId },
  )
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    outcome: 'completed',
  })
  run.resolveTerminal()
  return { tx: { runId: run.runId, actionId: run.actionId, outcome: 'completed' }, successor }
}

async function abortRun(
  run: RunState,
  ctx: RunCtx,
  cause: { reason: 'user-cancel' | 'phase-failure' | 'preflight-failure'; error?: PipelineError },
): Promise<TxResult> {
  run.abortController.abort()
  let outcome: 'aborted' | 'failed' = cause.reason === 'user-cancel' ? 'aborted' : 'failed'
  let error = cause.error
  try {
    await reverseReplayDeltas(run.actionId, ctx)
  } catch (e) {
    if (!(e instanceof DeltaReplayError)) throw e
    error = { kind: 'orchestrator', detail: `reverse-replay failed: ${String(e.cause)}` }
    outcome = 'failed'
  }
  generationStore.abortRun(run.runId)
  try {
    await ctx.db
      .update(pipelineRuns)
      .set({ finishedAt: Date.now(), outcome })
      .where(eq(pipelineRuns.runId, run.runId))
  } catch (e) {
    // Deltas are already reversed; a failed marker leaves an orphan that boot
    // recovery re-reverses idempotently. Finish cleanly regardless.
    logger.error(
      'pipeline.marker_write_failed',
      { runId: run.runId, outcome, error: String(e) },
      { actionId: run.actionId },
    )
  }
  turnCaptureSink.endTurn(run.actionId, outcome, cause.reason)
  logger.error('pipeline.run_aborted', { runId: run.runId, outcome }, { actionId: run.actionId })
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    outcome,
    ...(error ? { error } : {}),
  })
  run.resolveTerminal()
  return { runId: run.runId, actionId: run.actionId, outcome, ...(error ? { error } : {}) }
}

type AbortCause = {
  reason: 'user-cancel' | 'phase-failure' | 'preflight-failure'
  error?: PipelineError
}
type PhaseOutcome = { kind: 'completed' } | { kind: 'aborted'; cause: AbortCause }

async function runPhases(run: RunState, ctx: RunCtx): Promise<PhaseOutcome> {
  const pipeline = getPipeline(run.kind)
  try {
    for (const node of pipeline.phases) {
      const result = await runNode(node, run, ctx)
      if (result.status === 'failed')
        return { kind: 'aborted', cause: { reason: 'phase-failure', error: result.error } }
      if (result.status === 'aborted') return { kind: 'aborted', cause: { reason: 'user-cancel' } }
    }
  } catch (e) {
    const error: PipelineError =
      e instanceof ActionLayerError
        ? { kind: 'action-layer', detail: e.detail }
        : { kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) }
    return { kind: 'aborted', cause: { reason: 'phase-failure', error } }
  }
  return { kind: 'completed' }
}

export async function runPipeline(kind: string, ctx: RunCtx): Promise<TxResult | RejectedStart> {
  // Loop so a yield-wait can't act on a stale decision: after aborting + awaiting the
  // yielding runs, re-check; a blocking run may have started during the wait.
  for (;;) {
    const txState = generationStore.getTxState()
    const decision = checkConcurrencyContract(kind, txState.runs, txState.reversalInProgress)
    if (decision.kind === 'blocked') {
      logger.debug('pipeline.run_rejected', { kind, blockedBy: decision.by })
      return { outcome: 'rejected', blockedBy: decision.by }
    }
    if (decision.kind === 'start') break
    await Promise.all(
      decision.targets.map((id) => {
        const target = txState.runs.get(id)
        target?.abortController.abort()
        return target?.terminal
      }),
    )
  }
  // reserveRun registers synchronously right after the loop's 'start' (race-free for
  // the common path); beginRun then persists the marker and emits run_start.
  let run = reserveRun(kind, ctx)
  await beginRun(run, ctx)
  // Drive the run; on a chained commit, drive the successor too. The whole chain is
  // awaited, but the caller gets the ORIGIN run's result — downstream chain outcomes
  // are observed on the event bus, not the return value.
  let originResult: TxResult | undefined
  for (;;) {
    // A throwing resolver predicate (or any preflight error) must wind the run down
    // through the normal abort path — rejecting here would orphan the registered run
    // and its unresolved terminal, blocking edits and deadlocking awaitRunTerminal.
    let preflightError: PipelineError | null
    try {
      preflightError = runPreflight(getPipeline(run.kind), {
        appSettings: appSettingsStore.getAppSettings(),
      })
    } catch (e) {
      preflightError = { kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) }
    }
    if (preflightError) {
      const tx = await abortRun(run, ctx, { reason: 'preflight-failure', error: preflightError })
      return originResult ?? tx
    }
    const outcome = await runPhases(run, ctx)
    if (outcome.kind === 'aborted') {
      const tx = await abortRun(run, ctx, outcome.cause)
      return originResult ?? tx
    }
    const { tx, successor } = await commitRun(run, ctx)
    originResult ??= tx
    if (!successor) return originResult
    await startChainedSuccessor(successor, ctx)
    run = successor
  }
}
