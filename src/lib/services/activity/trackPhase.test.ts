import { describe, it, expect, vi } from 'vitest'
import { trackPhase } from './trackPhase'
import { trackStep, type ActivityReporter } from './reporter'

function reporter() {
  const closed: { id: string; status: string }[] = []
  const started: string[] = []
  const activity: ActivityReporter = {
    startStep: (label) => {
      started.push(label)
      return `s${started.length}`
    },
    endStep: (id, status = 'done') => {
      if (closed.some((c) => c.id === id)) return
      closed.push({ id, status })
    },
    recordStep: () => '',
  }
  return { activity, started, closed }
}

async function drain<E, R>(gen: AsyncGenerator<E, R>) {
  const events: E[] = []
  for (;;) {
    const next = await gen.next()
    if (next.done) return { events, result: next.value }
    events.push(next.value)
  }
}

const phaseOf = (events: { type: string; error?: unknown }[], result: unknown = 'ok') =>
  (async function* () {
    for (const e of events) yield e
    return result
  })()

describe('trackPhase', () => {
  it('opens a step and closes it as done, passing events and result through', async () => {
    const { activity, started, closed } = reporter()

    const { events, result } = await drain(
      trackPhase(
        activity,
        activity.startStep('Classification'),
        phaseOf([{ type: 'phase_start' }]),
      ),
    )

    expect(started).toEqual(['Classification'])
    expect(closed).toEqual([{ id: 's1', status: 'done' }])
    expect(events).toEqual([{ type: 'phase_start' }])
    expect(result).toBe('ok')
  })

  it('records a tolerated failure as failed rather than dropping it', async () => {
    const { activity, closed } = reporter()

    // A phase that degrades yields an error event and still returns; the turn continues.
    const { result } = await drain(
      trackPhase(
        activity,
        activity.startStep('Classification'),
        phaseOf([{ type: 'phase_start' }, { type: 'error' }], null),
      ),
    )

    expect(closed).toEqual([{ id: 's1', status: 'failed' }])
    expect(result).toBeNull()
  })

  it('records an aborted phase as skipped', async () => {
    const { activity, closed } = reporter()

    await drain(
      trackPhase(activity, activity.startStep('Images'), phaseOf([{ type: 'aborted' }], null)),
    )

    expect(closed).toEqual([{ id: 's1', status: 'skipped' }])
  })

  it('closes the step as failed and re-raises when the phase throws', async () => {
    const { activity, closed } = reporter()
    const phase = (async function* () {
      yield { type: 'phase_start' }
      throw new Error('boom')
    })()

    await expect(
      drain(trackPhase(activity, activity.startStep('Narrative'), phase)),
    ).rejects.toThrow('boom')
    expect(closed).toEqual([{ id: 's1', status: 'failed' }])
  })

  it('closes the inner phase when the wrapper is abandoned', async () => {
    const { activity, closed } = reporter()
    const cleanup = vi.fn()
    const phase = (async function* () {
      try {
        yield { type: 'phase_start' }
        yield { type: 'phase_complete' }
      } finally {
        cleanup()
      }
    })()

    const wrapped = trackPhase(activity, activity.startStep('Translation'), phase)
    await wrapped.next()
    await wrapped.return(undefined as never)

    expect(cleanup).toHaveBeenCalled()
    expect(closed).toHaveLength(1)
  })

  it('reports an error even when a later event is ordinary', async () => {
    const { activity, closed } = reporter()

    await drain(
      trackPhase(
        activity,
        activity.startStep('Images'),
        phaseOf([{ type: 'error' }, { type: 'phase_complete' }], null),
      ),
    )

    expect(closed).toEqual([{ id: 's1', status: 'failed' }])
  })
})

describe('failure reasons', () => {
  function reasons() {
    const closed: { status?: string; reason?: string | null }[] = []
    const activity: ActivityReporter = {
      startStep: () => 's1',
      endStep: (_id, status, _detail, reason) => closed.push({ status, reason }),
      recordStep: () => '',
    }
    return { activity, closed }
  }

  it('closes a phase with the reason carried by its error event', async () => {
    const { activity, closed } = reasons()

    await drain(
      trackPhase(activity, 's1', phaseOf([{ type: 'error', error: new Error('provider down') }])),
    )

    expect(closed).toEqual([{ status: 'failed', reason: 'provider down' }])
  })

  it('closes a phase that throws with the reason of the throw', async () => {
    const { activity, closed } = reasons()
    const phase = (async function* () {
      yield { type: 'phase_start' }
      throw new Error('template not found')
    })()

    await expect(drain(trackPhase(activity, 's1', phase))).rejects.toThrow('template not found')
    expect(closed).toEqual([{ status: 'failed', reason: 'template not found' }])
  })

  it('closes a step run by trackStep with the reason of its throw, and rethrows', async () => {
    const { activity, closed } = reasons()

    await expect(
      trackStep(activity, 'Generating suggestions', {}, async () => {
        throw new Error('rate limited')
      }),
    ).rejects.toThrow('rate limited')
    expect(closed).toEqual([{ status: 'failed', reason: 'rate limited' }])
  })
})
