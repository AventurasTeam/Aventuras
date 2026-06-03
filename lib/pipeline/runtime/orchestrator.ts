import { eq } from 'drizzle-orm'

import {
  DeltaReplayError,
  applyDeltaAction,
  reverseReplayDeltas,
  type DbCtx,
  type MutationResult,
} from '@/lib/actions'
import { pipelineRuns } from '@/lib/db'
import {
  clearCurrentActionId,
  logger,
  setCurrentActionId,
  turnCaptureSink,
} from '@/lib/diagnostics'
import { generateId } from '@/lib/ids'
import { domain, type RunState } from '@/lib/stores'

import { pipelineEventBus } from './event-bus'
import { getPipeline } from '../authoring/registry'
import type { PhaseEmittedEvent, PhaseNode, PhaseResult, PipelineError, TxResult } from '../types'

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
  return {
    runId: generateId('run'),
    kind,
    actionId: generateId('act'),
    storyId: ctx.storyId,
    branchId: ctx.branchId,
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
  }
}

async function beginRun(kind: string, ctx: RunCtx): Promise<RunState> {
  const run = newRunState(kind, ctx)
  await ctx.db.insert(pipelineRuns).values({
    runId: run.runId,
    kind,
    actionId: run.actionId,
    storyId: ctx.storyId,
    startedAt: Date.now(),
  })
  domain.startRun(run)
  domain.setActiveRun(run.runId)
  setCurrentActionId(run.actionId)
  turnCaptureSink.beginTurn({ actionId: run.actionId, branchId: run.branchId })
  pipelineEventBus.emit({ type: 'run_start', runId: run.runId, kind, actionId: run.actionId })
  return run
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
    logger.warn('pipeline.recoverable_error', { detail: event.error.detail ?? event.error.kind })
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

async function runParallelGroup(
  branches: readonly { name: string; run: () => AsyncGenerator<PhaseEmittedEvent, PhaseResult> }[],
  run: RunState,
  ctx: RunCtx,
): Promise<PhaseResult> {
  const results = await Promise.all(
    branches.map(async (b) => {
      pipelineEventBus.emit({ type: 'phase_start', runId: run.runId, name: b.name })
      const result = await consumePhase(b.run(), run, ctx)
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
  domain.setCurrentPhase(run.runId, node.name)
  turnCaptureSink.appendPhaseEvent(run.actionId, {
    phase: node.name,
    kind: 'enter',
    at: Date.now(),
  })
  pipelineEventBus.emit({ type: 'phase_start', runId: run.runId, name: node.name })
  const result =
    'parallel' in node
      ? await runParallelGroup(node.parallel, run, ctx)
      : await consumePhase(node.run(), run, ctx)
  turnCaptureSink.appendPhaseEvent(run.actionId, { phase: node.name, kind: 'exit', at: Date.now() })
  domain.recordPhaseResult(run.runId, node.name, result)
  pipelineEventBus.emit({ type: 'phase_complete', runId: run.runId, name: node.name, result })
  return result
}

async function commitRun(run: RunState, ctx: RunCtx): Promise<TxResult> {
  const pipeline = getPipeline(run.kind)
  const nextKind = pipeline.chainsTo?.(run, undefined) ?? null
  // Chained execution is parked (Scope:out); 1.5a performs only the synchronous
  // store transition so the gate stays closed across the boundary.
  const successor = nextKind ? newRunState(nextKind, ctx) : undefined
  domain.finishRun(run.runId, successor)
  try {
    await ctx.db
      .update(pipelineRuns)
      .set({ finishedAt: Date.now(), outcome: 'completed' })
      .where(eq(pipelineRuns.runId, run.runId))
  } catch (e) {
    // The run's writes already committed; a failed marker leaves an orphan that
    // boot recovery reconciles. Finish cleanly regardless — the ambient actionId
    // and active-run slot must never leak into the next run.
    logger.error('pipeline.marker_write_failed', {
      runId: run.runId,
      outcome: 'completed',
      error: String(e),
    })
  }
  turnCaptureSink.endTurn(run.actionId, 'completed')
  clearCurrentActionId()
  domain.clearActiveRun()
  logger.debug('pipeline.run_complete', { runId: run.runId, kind: run.kind, outcome: 'completed' })
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    outcome: 'completed',
  })
  return { runId: run.runId, actionId: run.actionId, outcome: 'completed' }
}

async function abortRun(
  run: RunState,
  ctx: RunCtx,
  cause: { reason: 'user-cancel' | 'phase-failure'; error?: PipelineError },
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
  domain.abortRun(run.runId)
  try {
    await ctx.db
      .update(pipelineRuns)
      .set({ finishedAt: Date.now(), outcome })
      .where(eq(pipelineRuns.runId, run.runId))
  } catch (e) {
    // Deltas are already reversed; a failed marker leaves an orphan that boot
    // recovery re-reverses idempotently. Finish cleanly regardless.
    logger.error('pipeline.marker_write_failed', {
      runId: run.runId,
      outcome,
      error: String(e),
    })
  }
  turnCaptureSink.endTurn(run.actionId, outcome, cause.reason)
  clearCurrentActionId()
  domain.clearActiveRun()
  logger.error('pipeline.run_aborted', { runId: run.runId, outcome })
  pipelineEventBus.emit({
    type: 'run_complete',
    runId: run.runId,
    kind: run.kind,
    actionId: run.actionId,
    outcome,
    ...(error ? { error } : {}),
  })
  return { runId: run.runId, actionId: run.actionId, outcome, ...(error ? { error } : {}) }
}

export async function runPipeline(kind: string, ctx: RunCtx): Promise<TxResult> {
  const pipeline = getPipeline(kind)
  const run = await beginRun(kind, ctx)
  try {
    for (const node of pipeline.phases) {
      const result = await runNode(node, run, ctx)
      if (result.status === 'failed')
        return abortRun(run, ctx, { reason: 'phase-failure', error: result.error })
      if (result.status === 'aborted') return abortRun(run, ctx, { reason: 'user-cancel' })
    }
  } catch (e) {
    const error: PipelineError =
      e instanceof ActionLayerError
        ? { kind: 'action-layer', detail: e.detail }
        : { kind: 'orchestrator', detail: e instanceof Error ? e.message : String(e) }
    return abortRun(run, ctx, { reason: 'phase-failure', error })
  }
  return commitRun(run, ctx)
}
