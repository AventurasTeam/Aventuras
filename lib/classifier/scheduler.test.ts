import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createClassifierScheduler } from './scheduler'
import { idleStatus } from './status'

function harness(over: Partial<Parameters<typeof createClassifierScheduler>[0]> = {}) {
  const timers: { fn: () => void; ms: number }[] = []
  const deps = {
    cadenceFor: vi.fn(() => 4),
    headPositionFor: vi.fn(async () => 8),
    statusFor: vi.fn(async () => idleStatus()),
    startRun: vi.fn(async () => ({ outcome: 'completed' as const })),
    setTimer: vi.fn((fn: () => void, ms: number) => {
      timers.push({ fn, ms })
      return timers.length - 1
    }),
    clearTimer: vi.fn(),
    ...over,
  }
  return { deps, timers, scheduler: createClassifierScheduler(deps) }
}

describe('createClassifierScheduler', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts a run when the cadence is reached', async () => {
    const { deps, scheduler } = harness()
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.startRun).toHaveBeenCalledWith('branch_1')
  })

  it('does not start when the cadence is not reached', async () => {
    const { deps, scheduler } = harness({ headPositionFor: vi.fn(async () => 3) })
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.startRun).not.toHaveBeenCalled()
  })

  it('does not start while its own run is in flight', async () => {
    let release!: () => void
    const startRun = vi.fn(
      () =>
        new Promise<{ outcome: 'completed' }>((r) => (release = () => r({ outcome: 'completed' }))),
    )
    const { scheduler } = harness({ startRun })
    const first = scheduler.noteTurnCommitted('branch_1')
    await scheduler.noteTurnCommitted('branch_1')
    expect(startRun).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('waits for the next tick on a rejected start, scheduling no retry', async () => {
    const { deps, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'rejected' as const, blockedBy: 'chapter-close' })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.setTimer).not.toHaveBeenCalled()
  })

  // retryCount is the number of failures SO FAR (nextStatusOnFailure already
  // incremented it), so attempt N waits BACKOFF_MS[N - 1]. Both arms pinned
  // because the scheduler and the reducer must agree on that convention.
  it('schedules the first backoff on the first failure', async () => {
    const { deps, timers, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'retrying' as const,
        retryCount: 1,
      })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    expect(timers.at(-1)?.ms).toBe(30_000)
    expect(deps.setTimer).toHaveBeenCalledTimes(1)
  })

  it('schedules the second backoff on the second failure', async () => {
    const { timers, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'retrying' as const,
        retryCount: 2,
      })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    expect(timers.at(-1)?.ms).toBe(120_000)
  })

  it('schedules nothing in failed-persistent', async () => {
    const { deps, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'failed-persistent' as const,
        retryCount: 3,
      })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.setTimer).not.toHaveBeenCalled()
  })

  it('stop() clears a pending retry timer and blocks further starts', async () => {
    const { deps, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'retrying' as const,
        retryCount: 1,
      })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    scheduler.stop()
    expect(deps.clearTimer).toHaveBeenCalled()
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.startRun).toHaveBeenCalledTimes(1)
  })

  it('no-ops when a retry timer fires after stop()', async () => {
    const { deps, timers, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'retrying' as const,
        retryCount: 1,
      })),
    })
    await scheduler.noteTurnCommitted('branch_1')
    scheduler.stop()
    timers.at(-1)?.fn()
    await Promise.resolve()
    expect(deps.startRun).toHaveBeenCalledTimes(1)
  })

  it('runNow() starts regardless of the cadence count', async () => {
    const { deps, scheduler } = harness({ headPositionFor: vi.fn(async () => 1) })
    await scheduler.runNow('branch_1')
    expect(deps.startRun).toHaveBeenCalledWith('branch_1')
  })

  it('runNow() starts even in failed-persistent', async () => {
    const { deps, scheduler } = harness({
      statusFor: vi.fn(async () => ({
        ...idleStatus(),
        state: 'failed-persistent' as const,
        retryCount: 3,
      })),
    })
    await scheduler.runNow('branch_1')
    expect(deps.startRun).toHaveBeenCalledWith('branch_1')
  })

  it('releases the in-flight guard after a failed run so a later run can start', async () => {
    // Idle at the cadence check, exhausted by the post-failure read: the tick
    // fires, the run fails, no retry is scheduled, and the guard must still
    // release or the manual run below would be silently swallowed.
    let call = 0
    const { deps, scheduler } = harness({
      startRun: vi.fn(async () => ({ outcome: 'failed' as const })),
      statusFor: vi.fn(async () =>
        ++call === 1
          ? idleStatus()
          : { ...idleStatus(), state: 'failed-persistent' as const, retryCount: 3 },
      ),
    })
    await scheduler.noteTurnCommitted('branch_1')
    expect(deps.setTimer).not.toHaveBeenCalled()
    await scheduler.runNow('branch_1')
    expect(deps.startRun).toHaveBeenCalledTimes(2)
  })
})
