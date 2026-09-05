/**
 * Track Phase
 *
 * Records a phase as one step, reading the outcome off the events it already yields.
 *
 * Wrapping rather than instrumenting each phase: `ImagePhase` alone has five completion
 * paths, and a step closed at only four of them is worse than none.
 */

import type { ActivityReporter } from './reporter'
import type { StartStepOptions } from './recorder'

/** The only thing this needs of a phase event. */
interface PhaseEvent {
  type: string
}

export async function* trackPhase<E extends PhaseEvent, R>(
  activity: ActivityReporter,
  label: string,
  phase: AsyncGenerator<E, R>,
  options: StartStepOptions = {},
): AsyncGenerator<E, R> {
  const id = activity.startStep(label, options)
  let status: 'done' | 'failed' | 'skipped' = 'done'
  try {
    let next = await phase.next()
    while (!next.done) {
      const event = next.value
      if (event.type === 'error') status = 'failed'
      else if (event.type === 'aborted') status = 'skipped'
      yield event
      next = await phase.next()
    }
    return next.value
  } catch (error) {
    status = 'failed'
    throw error
  } finally {
    // The loop steps the phase by hand rather than delegating, so abandoning this generator
    // would otherwise leave the phase's own cleanup unrun.
    await phase.return(undefined as R)
    activity.endStep(id, status)
  }
}
