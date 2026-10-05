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

  it('records a phase kept off by a setting as skipped, noting the setting', async () => {
    const details: (string | undefined)[] = []
    const { activity, closed } = reporter()
    const endStep = activity.endStep
    activity.endStep = (id, status, detail) => {
      details.push(detail)
      endStep(id, status)
    }
    const offBy = (result: unknown) => (result === 'off' ? 'off in story settings' : null)

    await drain(
      trackPhase(activity, activity.startStep('Background image'), phaseOf([], 'off'), { offBy }),
    )
    await drain(
      trackPhase(activity, activity.startStep('Background image'), phaseOf([], 'ran'), { offBy }),
    )

    expect(closed.map((c) => c.status)).toEqual(['skipped', 'done'])
    expect(details).toEqual(['off in story settings', undefined])
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

describe('trackPhase, a phase switched off', () => {
  it('drops the step of a phase whose result says it was switched off', async () => {
    const discarded: string[] = []
    const { activity, closed } = reporter()
    activity.discardStep = (id) => discarded.push(id)
    const hiddenBy = (result: unknown) => result === 'off'

    await drain(
      trackPhase(activity, activity.startStep('Translation'), phaseOf([], 'off'), { hiddenBy }),
    )

    expect(discarded).toEqual(['s1'])
    expect(closed).toEqual([])
  })
})

describe('trackStep, a failure the work reports', () => {
  it('closes the step as failed with the reason the work returned', async () => {
    const closed: [string, string | undefined, string | null | undefined][] = []
    const activity: ActivityReporter = {
      startStep: () => 's1',
      endStep: (id, status, _detail, error) => closed.push([id, status, error]),
      recordStep: () => '',
    }

    const result = await trackStep(activity, 'Generating suggestions', {}, async () => ({
      suggestions: [],
      failure: '429 · rate limited',
    }))

    expect(result.suggestions).toEqual([])
    expect(closed).toEqual([['s1', 'failed', '429 · rate limited']])
  })
})

describe('trackStep, an abort the work reports', () => {
  it('closes the step as skipped when the reported failure is null', async () => {
    const closed: [string, string | undefined][] = []
    const activity: ActivityReporter = {
      startStep: () => 's1',
      endStep: (id, status) => closed.push([id, status]),
      recordStep: () => '',
    }

    await trackStep(activity, 'Translating suggestions', {}, async () => ({
      items: [],
      failure: null,
    }))

    expect(closed).toEqual([['s1', 'skipped']])
  })
})
