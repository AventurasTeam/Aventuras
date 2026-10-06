/**
 * Track Phase
 *
 * Records a phase as one step, reading the outcome off the events it already yields.
 *
 * Wrapping rather than instrumenting each phase: `ImagePhase` alone has five completion
 * paths, and a step closed at only four of them is worse than none.
 */

import type { ActivityReporter } from './reporter'
import { describeActivityError, isAbortError } from './describeError'

/** The only thing this needs of a phase event. */
interface PhaseEvent {
  type: string
  error?: unknown
}

/**
 * `stepId` is opened by the caller rather than here, so the same id can be handed to the
 * phase as the parent for whatever it reports itself.
 */
export interface TrackPhaseOptions<R> {
  /** Reads the finished phase's result for why it could not run; the step is skipped with that note. */
  offBy?: (result: R) => string | null
  /** Reads the finished phase's result for whether it was switched off; its step is then dropped. */
  hiddenBy?: (result: R) => boolean
}

export async function* trackPhase<E extends PhaseEvent, R>(
  activity: ActivityReporter,
  stepId: string,
  phase: AsyncGenerator<E, R>,
  { offBy, hiddenBy }: TrackPhaseOptions<R> = {},
): AsyncGenerator<E, R> {
  const id = stepId
  let status: 'done' | 'failed' | 'skipped' | 'hidden' = 'done'
  let reason: string | null = null
  let detail: string | undefined
  try {
    let next = await phase.next()
    while (!next.done) {
      const event = next.value
      if (event.type === 'error') {
        status = 'failed'
        reason = describeActivityError(event.error)
      } else if (event.type === 'aborted') status = 'skipped'
      yield event
      next = await phase.next()
    }
    if (status === 'done' && hiddenBy?.(next.value)) status = 'hidden'
    const off = status === 'done' ? offBy?.(next.value) : null
    if (off) {
      status = 'skipped'
      detail = off
    }
    return next.value
  } catch (error) {
    if (isAbortError(error)) status = 'skipped'
    else {
      status = 'failed'
      reason = describeActivityError(error)
    }
    throw error
  } finally {
    // The loop steps the phase by hand rather than delegating, so abandoning this generator
    // would otherwise leave the phase's own cleanup unrun.
    await phase.return(undefined as R)
    if (status === 'hidden') activity.discardStep?.(id)
    else activity.endStep(id, status, detail, reason)
  }
}
