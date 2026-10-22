import { eq } from 'drizzle-orm'

import type { MutationResult } from '@/lib/actions/types'
import { pipelineRuns, type DbCtx } from '@/lib/db'
import { logger, makeLogger, turnCaptureSink, type LogKind } from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { appSettingsStore, currentStoryStore, generationStore, type RunState } from '@/lib/stores'

import { getPipeline, getPipelineSafe } from '../authoring/registry'
import type {
  PhaseContext,
  PhaseEmittedEvent,
  PhaseFn,
  PhaseNode,
  PhaseResult,
  PipelineError,
  PipelineInputMap,
  RejectedStart,
  TxResult,
} from '../types'
import {
  applyDeltaAction,
  describeReplayError,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  reverseReplayDeltas,
  settleUserWrites,
} from './action-port'
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

export type RunCtx = {
  storyId: string | null
  branchId: string
  actionId?: string
  // Kind-specific run parameters the starting action hands to the phases
  // (generation-pipeline.md → Run-scoped state: inputs, not intermediates).
  inputs?: unknown
  /** Send's deferred work: shown as "before your turn", cancelled with the Send. */
  beforeTurn?: boolean
  /** Called once the run is in txState, before any await; not for a chain's successor. */
  onReserved?: () => void
} & DbCtx

// RunCtx with `inputs` narrowed to whatever the kind declares in
// PipelineInputMap, and required when it declares one. A kind absent from the
// map is unconstrained, so ad-hoc test kinds still type-check.
export type RunCtxFor<K extends string> = RunCtx &
  (K extends keyof PipelineInputMap ? { inputs: PipelineInputMap[K] } : { inputs?: unknown })

export type PipelineStart = {
  /**
   * The starting run's result, or the refusal; settles at its commit or abort. Rejects on the
   * origin's own throws, so a caller that keeps only `chain` must still handle it.
   */
  origin: Promise<TxResult | RejectedStart>
  /** Settles when the chain's last run ends; never rejects. */
  chain: Promise<void>
}

function newRunState(kind: string, ctx: RunCtx): RunState {
  let resolveTerminal!: () => void
  const terminal = new Promise<void>((resolve) => {
    resolveTerminal = resolve
  })
  const pipeline = getPipeline(kind)
  return {
    runId: generateId('run'),
    kind,
    gateBehavior: pipeline.gateBehavior,
    interruptible: pipeline.interruptible ?? null,
    beforeTurn: ctx.beforeTurn ?? false,
    actionId: ctx.actionId ?? generateId('act'),
    storyId: ctx.storyId,
    branchId: ctx.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    inputs: ctx.inputs,
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
  ctx.onReserved?.()
  return run
}

// A failed marker insert unwinds the reservation, so it can't gate edits or block a retry, and
// run_complete reports the idle: a successor's predecessor sent its own while this was registered.
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
    generationStore.abortRun(run.runId, 'unwound')
    pipelineEventBus.emit({
      type: 'run_complete',
      runId: run.runId,
      kind: run.kind,
      actionId: run.actionId,
      beforeTurn: run.beforeTurn,
      outcome: 'failed',
      error: {
        kind: 'orchestrator',
        detail: `marker insert failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    })
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
    if (result.status === 'rejected') {
      // A handler marks a rejection 'noop' when the action was well-formed and
      // simply changed nothing — a state patch restating current values, or a
      // promotion the other writer already landed. Both are ordinary with a real
      // model, and failing the run would reverse the user's whole turn over a
      // write that was never needed. Skipped, not logged as an error, and no
      // delta is written: there is nothing to undo.
      if (result.code === 'noop') {
        logger.debug(
          'pipeline.action_noop',
          { kind: event.action.kind, reason: result.reason },
          { actionId: run.actionId },
        )
        return
      }
      throw new ActionRejectedError(result.reason)
    }
    if (event.action.kind === 'createStoryEntry' && event.entryId) {
      turnCaptureSink.recordTargetEntry(run.actionId, event.entryId)
    }
  } else if (event.type === 'recoverable_error') {
    logger.warn(
      'pipeline.recoverable_error',
      { detail: event.error.detail ?? event.error.kind },
      { actionId: run.actionId },
    )
  }
  // stream_chunk: forwarded verbatim; the reader renders it live per channel.
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

function phaseContextOf(run: RunState, ctx: RunCtx): PhaseContext {
  return {
    actionId: run.actionId,
    abortSignal: run.abortController.signal,
    inputs: run.inputs,
    intermediates: run.intermediates,
    log: makeLogger(run.actionId),
    db: ctx.db,
    runInTransaction: ctx.runInTransaction,
    storyId: run.storyId,
    branchId: run.branchId,
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
      const result = await consumePhase(b.run(phaseContextOf(run, ctx)), run, ctx)
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
      : await consumePhase(node.run(phaseContextOf(run, ctx)), run, ctx)
  turnCaptureSink.appendPhaseEvent(run.actionId, { phase: node.name, kind: 'exit', at: Date.now() })
  generationStore.recordPhaseResult(run.runId, node.name, result)
  pipelineEventBus.emit({ type: 'phase_complete', runId: run.runId, name: node.name, result })
  return result
}

// Awaited while the run is still in txState, so the gate stays up across the read. A throw
// chains nothing: the run's own writes are done and must still commit.
async function nextKindOf(run: RunState, ctx: RunCtx): Promise<string | null> {
  const chainsTo = getPipeline(run.kind).chainsTo
  if (!chainsTo) return null
  try {
    return await chainsTo(run, ctx)
  } catch (e) {
    logger.error(
      'pipeline.chain_eval_failed',
      { runId: run.runId, kind: run.kind, error: e instanceof Error ? e.message : String(e) },
      { actionId: run.actionId },
    )
    return null
  }
}

async function commitRun(
  run: RunState,
  ctx: RunCtx,
): Promise<{ tx: TxResult; successor?: RunState }> {
  const aborted = () => run.abortController.signal.aborted
  // An abort before or during the awaited read still commits the turn but chains no pass.
  const chained = aborted() ? null : await nextKindOf(run, ctx)
  const nextKind = aborted() ? null : chained
  // chainsTo may name an unregistered kind (authoring bug); resolve it without
  // throwing so a bad chain can't strand the just-committed run in txState.runs.
  const nextPipeline = nextKind ? getPipelineSafe(nextKind) : undefined
  if (nextKind && !nextPipeline)
    logger.error(
      'pipeline.chain_target_missing',
      { runId: run.runId, kind: run.kind, nextKind },
      { actionId: run.actionId },
    )
  // A chained run gets its own context: no inputs, its own actionId, never Send's deferred work
  // (generation-pipeline.md → chainsTo on predecessor).
  const successor = nextPipeline
    ? newRunState(nextPipeline.kind, {
        ...ctx,
        inputs: undefined,
        actionId: undefined,
        beforeTurn: undefined,
      })
    : undefined
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
    beforeTurn: run.beforeTurn,
    outcome: 'completed',
  })
  run.resolveTerminal()
  return { tx: { runId: run.runId, actionId: run.actionId, outcome: 'completed' }, successor }
}

async function runHook(
  run: RunState,
  failureKind: LogKind,
  hook: () => Promise<void>,
): Promise<void> {
  try {
    await hook()
  } catch (hookError) {
    logger.error(
      failureKind,
      {
        runId: run.runId,
        error: hookError instanceof Error ? hookError.message : String(hookError),
      },
      { actionId: run.actionId },
    )
  }
}

async function runPhaseExceptionHook(
  run: RunState,
  ctx: RunCtx,
  error: PipelineError,
): Promise<void> {
  if (error.kind !== 'action-layer' && error.kind !== 'orchestrator') return
  const onPhaseException = getPipeline(run.kind).onPhaseException
  if (!onPhaseException) return
  // The run's own identity: a successor shares the origin's ctx, which may carry another run's
  // actionId or none.
  await runHook(run, 'pipeline.phase_exception_hook_failed', () =>
    onPhaseException({ db: ctx.db, branchId: run.branchId, actionId: run.actionId }, error),
  )
}

async function runInterruptHook(run: RunState, ctx: RunCtx): Promise<void> {
  const onInterrupt = getPipeline(run.kind).onInterrupt
  if (!onInterrupt) return
  await runHook(run, 'pipeline.interrupt_hook_failed', () =>
    onInterrupt({
      db: ctx.db,
      branchId: run.branchId,
      actionId: run.actionId,
      intermediates: run.intermediates,
    }),
  )
}

type AbortCause =
  | { reason: 'user-cancel' }
  | { reason: 'preflight-failure'; error: PipelineError }
  // `threw`: thrown, not returned as failed — onPhaseException's only trigger (see ../types.ts).
  | { reason: 'phase-failure'; error: PipelineError; threw: boolean }

async function abortRun(run: RunState, ctx: RunCtx, cause: AbortCause): Promise<TxResult> {
  run.abortController.abort()
  let outcome: 'aborted' | 'failed' = cause.reason === 'user-cancel' ? 'aborted' : 'failed'
  let error = cause.reason === 'user-cancel' ? undefined : cause.error
  const markerOp = (settled: 'aborted' | 'failed') =>
    ctx.db
      .update(pipelineRuns)
      .set({ finishedAt: Date.now(), outcome: settled })
      .where(eq(pipelineRuns.runId, run.runId))
  let reversalFailed = false
  // generation-pipeline.md → Branch write lock: a rollback preview's reads never straddle a pass's
  // or a close's reversal. Its writes took no hold: under the gate no user write meets them.
  if (run.interruptible) await holdBranchWriteExclusive(run.branchId, run.actionId)
  try {
    // Marker rides the reversal's transaction: never records an uncommitted reversal.
    await reverseReplayDeltas(run.actionId, ctx, () => [markerOp(outcome).toSQL()])
  } catch (e) {
    const failure = describeReplayError(e)
    if (failure === undefined) throw e
    const stage = failure.committed ? 'post-commit store sync' : 'reverse-replay'
    error = { kind: 'orchestrator', detail: `${stage} failed: ${failure.detail}` }
    outcome = 'failed'
    reversalFailed = !failure.committed
  } finally {
    // An uncommitted reversal releases it too: recovery owns those writes, and a held lock
    // would stall every write to the branch until boot.
    if (run.interruptible) releaseBranchWriteExclusive(run.branchId, run.actionId)
  }
  // Must run once the rollback has committed: arming a retry over writes still on disk would
  // race it into re-reading them; an uncommitted reversal leaves recovery to own the branch.
  // Must precede generationStore.abortRun below — that release drops the gate serializing this.
  if (cause.reason === 'phase-failure' && cause.threw && !reversalFailed)
    await runPhaseExceptionHook(run, ctx, cause.error)
  if (cause.reason === 'user-cancel' && !reversalFailed) await runInterruptHook(run, ctx)
  const newlyDeferred = generationStore.abortRun(run.runId, outcome)
  // Uncommitted: the marker rolled back with the reversal, so boot recovery still owns the run.
  if (reversalFailed)
    logger.warn(
      'pipeline.orphan_left_for_recovery',
      { runId: run.runId, outcome },
      { actionId: run.actionId },
    )
  turnCaptureSink.endTurn(run.actionId, outcome, cause.reason)
  logger.error(
    'pipeline.run_aborted',
    {
      runId: run.runId,
      outcome,
      reason: cause.reason,
      ...(error ? { errorKind: error.kind, errorDetail: error.detail } : {}),
    },
    { actionId: run.actionId },
  )
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    beforeTurn: run.beforeTurn,
    outcome,
    ...(error ? { error } : {}),
  })
  if (newlyDeferred)
    pipelineEventBus.emit({
      type: 'run_deferred',
      runId: run.runId,
      kind: run.kind,
      branchId: run.branchId,
      work: newlyDeferred,
    })
  run.resolveTerminal()
  return { runId: run.runId, actionId: run.actionId, outcome, ...(error ? { error } : {}) }
}

type PhaseOutcome = { kind: 'completed' } | { kind: 'aborted'; cause: AbortCause }

async function runPhases(run: RunState, ctx: RunCtx): Promise<PhaseOutcome> {
  const pipeline = getPipeline(run.kind)
  try {
    for (const node of pipeline.phases) {
      const result = await runNode(node, run, ctx)
      if (result.status === 'failed') {
        logger.error(
          'pipeline.phase_failed',
          {
            runId: run.runId,
            phase: node.name,
            errorKind: result.error.kind,
            errorDetail: result.error.detail,
          },
          { actionId: run.actionId },
        )
        return {
          kind: 'aborted',
          cause: { reason: 'phase-failure', error: result.error, threw: false },
        }
      }
      if (result.status === 'aborted') return { kind: 'aborted', cause: { reason: 'user-cancel' } }
    }
  } catch (e) {
    const error: PipelineError =
      e instanceof ActionLayerError
        ? { kind: 'action-layer', detail: e.detail }
        : { kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) }
    logger.error(
      'pipeline.phase_exception',
      { runId: run.runId, errorKind: error.kind, errorDetail: error.detail },
      { actionId: run.actionId },
    )
    return { kind: 'aborted', cause: { reason: 'phase-failure', error, threw: true } }
  }
  return { kind: 'completed' }
}

// A throwing resolver predicate (or any pre-flight error) takes the normal abort path: rejecting
// would orphan the registered run and its terminal, blocking edits and deadlocking awaitRunTerminal.
async function driveRun(
  run: RunState,
  ctx: RunCtx,
): Promise<{ tx: TxResult; successor?: RunState }> {
  // A cancel that landed before pre-flight (at a chain's swap, or as Send's owed pass reserved)
  // is an interrupt: a pre-flight failure would record a failed pass instead of a deferred one.
  if (run.abortController.signal.aborted)
    return { tx: await abortRun(run, ctx, { reason: 'user-cancel' }) }
  let preflightError: PipelineError | null
  try {
    preflightError = runPreflight(getPipeline(run.kind), {
      appSettings: appSettingsStore.getAppSettings(),
      storySettings: currentStoryStore.getCurrentStory()?.settings,
    })
  } catch (e) {
    preflightError = { kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) }
  }
  if (preflightError) {
    logger.error(
      'pipeline.preflight_failed',
      {
        runId: run.runId,
        errorKind: preflightError.kind,
        errorDetail: preflightError.detail,
      },
      { actionId: run.actionId },
    )
    // Before abortRun: that releases the run, and releasing it drops the gate
    // that serializes this write against the phases' own status writes.
    const onPreflightFailure = getPipeline(run.kind).onPreflightFailure
    if (onPreflightFailure)
      await runHook(run, 'pipeline.preflight_hook_failed', () =>
        onPreflightFailure(ctx, preflightError),
      )
    return { tx: await abortRun(run, ctx, { reason: 'preflight-failure', error: preflightError }) }
  }
  const outcome = await runPhases(run, ctx)
  if (outcome.kind === 'aborted') return { tx: await abortRun(run, ctx, outcome.cause) }
  return commitRun(run, ctx)
}

async function driveOrigin(
  kind: string,
  ctx: RunCtx,
): Promise<{ result: TxResult | RejectedStart; successor?: RunState }> {
  // Loop so a yield-wait can't act on a stale decision: after aborting + awaiting the
  // yielding runs, re-check; a blocking run may have started during the wait.
  for (;;) {
    const txState = generationStore.getTxState()
    const decision = checkConcurrencyContract(kind, txState.runs, txState.reversalInProgress)
    if (decision.kind === 'blocked') {
      logger.debug('pipeline.run_rejected', { kind, blockedBy: decision.by })
      return { result: { outcome: 'rejected', blockedBy: decision.by } }
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
  const run = reserveRun(kind, ctx)
  await beginRun(run, ctx)
  // A user write checks the gate before queueing on its row locks, so one that passed just before
  // reserveRun raised it could still commit under this run's reads. A chain's successor needs no
  // settle: the gate stayed up across the handoff.
  if (run.gateBehavior === 'hard-gate') await settleUserWrites()
  const { tx, successor } = await driveRun(run, ctx)
  return { result: tx, successor }
}

// Each successor is already in txState, swapped in at its predecessor's commit. Nothing here
// rejects: the origin's caller has its result, and a successor's failure is its own.
async function driveSuccessors(first: RunState | undefined, ctx: RunCtx): Promise<void> {
  let run = first
  while (run) {
    const current = run
    try {
      await beginRun(current, ctx)
    } catch (e) {
      logger.error(
        'pipeline.chain_start_failed',
        {
          runId: current.runId,
          kind: current.kind,
          error: e instanceof Error ? e.message : String(e),
        },
        { actionId: current.actionId },
      )
      return
    }
    try {
      run = (await driveRun(current, ctx)).successor
    } catch (e) {
      logger.error(
        'pipeline.chain_run_failed',
        {
          runId: current.runId,
          kind: current.kind,
          error: e instanceof Error ? e.message : String(e),
        },
        { actionId: current.actionId },
      )
      return
    }
  }
}

/** Starts `kind` and drives its chain; see `PipelineStart` for `origin` and `chain`. */
export function startPipeline<K extends string>(kind: K, ctx: RunCtxFor<K>): PipelineStart {
  const started = driveOrigin(kind, ctx)
  return {
    origin: started.then((s) => s.result),
    chain: started.then(
      (s) => driveSuccessors(s.successor, ctx),
      () => undefined,
    ),
  }
}

/** Starts `kind` and resolves with the origin run's result once the whole chain has ended. */
export async function runPipeline<K extends string>(
  kind: K,
  ctx: RunCtxFor<K>,
): Promise<TxResult | RejectedStart> {
  const { origin, chain } = startPipeline(kind, ctx)
  const [result] = await Promise.all([origin, chain])
  return result
}
