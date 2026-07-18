import { describe, expect, it, vi } from 'vitest'

import {
  createStoryRecoveryCoordinator,
  handleStoryRecoveryResetOutcome,
} from './story-recovery-coordinator'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function request(
  overrides: Partial<
    Parameters<ReturnType<typeof createStoryRecoveryCoordinator>['startReset']>[0]
  > = {},
) {
  return {
    storyId: 'story_1',
    reset: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({ status: 'ok' as const, branchId: 'br_1' }),
    navigate: vi.fn(),
    onOpened: vi.fn(),
    onOpenFailed: vi.fn(),
    ...overrides,
  }
}

describe('story recovery coordinator', () => {
  it('starts only one reset for duplicate requests on the active recovery', async () => {
    const resetDeferred = deferred<void>()
    const options = request({ reset: vi.fn(() => resetDeferred.promise) })
    const coordinator = createStoryRecoveryCoordinator()

    const first = coordinator.startReset(options)
    const duplicate = coordinator.startReset(options)

    expect(first).toBeInstanceOf(Promise)
    expect(duplicate).toBeUndefined()
    expect(options.reset).toHaveBeenCalledOnce()

    resetDeferred.resolve(undefined)
    await first
  })

  it('does not open when invalidated before reset settles', async () => {
    const resetDeferred = deferred<void>()
    const options = request({ reset: vi.fn(() => resetDeferred.promise) })
    const coordinator = createStoryRecoveryCoordinator()
    const operation = coordinator.startReset(options)

    coordinator.invalidate()
    resetDeferred.resolve(undefined)
    await operation

    expect(options.open).not.toHaveBeenCalled()
    expect(options.navigate).not.toHaveBeenCalled()
    expect(options.onOpened).not.toHaveBeenCalled()
    expect(options.onOpenFailed).not.toHaveBeenCalled()
  })

  it('suppresses navigation and state callbacks when invalidated during open', async () => {
    const openDeferred = deferred<{ status: 'cancelled' }>()
    let guardedNavigate: ((branchId: string) => void) | undefined
    let isCurrent: (() => boolean) | undefined
    const options = request({
      open: vi.fn((navigate, current) => {
        guardedNavigate = navigate
        isCurrent = current
        return openDeferred.promise
      }),
    })
    const coordinator = createStoryRecoveryCoordinator()
    const operation = coordinator.startReset(options)
    await vi.waitFor(() => expect(options.open).toHaveBeenCalledOnce())

    coordinator.invalidate()
    expect(isCurrent?.()).toBe(false)
    guardedNavigate?.('br_1')
    openDeferred.resolve({ status: 'cancelled' })
    await operation

    expect(options.navigate).not.toHaveBeenCalled()
    expect(options.onOpened).not.toHaveBeenCalled()
    expect(options.onOpenFailed).not.toHaveBeenCalled()
  })

  it('navigates and clears the current recovery after a successful open', async () => {
    const options = request({
      open: vi.fn(async (navigate, isCurrent) => {
        expect(isCurrent()).toBe(true)
        navigate('br_1')
        return { status: 'ok' as const, branchId: 'br_1' }
      }),
    })
    const coordinator = createStoryRecoveryCoordinator()

    await coordinator.startReset(options)

    expect(options.navigate).toHaveBeenCalledWith('br_1')
    expect(options.onOpened).toHaveBeenCalledOnce()
    expect(options.onOpenFailed).not.toHaveBeenCalled()
  })

  it('updates the current recovery kind after an open failure', async () => {
    const options = request({
      open: vi
        .fn()
        .mockResolvedValue({ status: 'open-failed' as const, kind: 'definition-corrupt' as const }),
    })
    const coordinator = createStoryRecoveryCoordinator()

    await coordinator.startReset(options)

    expect(options.onOpenFailed).toHaveBeenCalledWith('definition-corrupt')
    expect(options.onOpened).not.toHaveBeenCalled()
  })

  it('returns a reset-phase failure for the current reset rejection', async () => {
    const failure = new Error('reset failed')
    const options = request({ reset: vi.fn().mockRejectedValue(failure) })
    const coordinator = createStoryRecoveryCoordinator()

    await expect(coordinator.startReset(options)).resolves.toEqual({
      status: 'failed',
      phase: 'reset',
      error: failure,
    })

    expect(options.open).not.toHaveBeenCalled()

    const retryOptions = request()
    await coordinator.startReset(retryOptions)
    expect(retryOptions.reset).toHaveBeenCalledOnce()
  })

  it('returns a reopen-phase failure for the current post-reset rejection', async () => {
    const failure = new Error('open failed')
    const options = request({ open: vi.fn().mockRejectedValue(failure) })
    const coordinator = createStoryRecoveryCoordinator()

    await expect(coordinator.startReset(options)).resolves.toEqual({
      status: 'failed',
      phase: 'reopen',
      error: failure,
    })

    expect(options.reset).toHaveBeenCalledOnce()
    expect(options.onOpened).not.toHaveBeenCalled()
    expect(options.onOpenFailed).not.toHaveBeenCalled()
  })

  it('swallows an invalidated reset rejection', async () => {
    const resetDeferred = deferred<void>()
    const options = request({ reset: vi.fn(() => resetDeferred.promise) })
    const coordinator = createStoryRecoveryCoordinator()
    const operation = coordinator.startReset(options)

    coordinator.invalidate()
    resetDeferred.reject(new Error('obsolete reset failure'))

    await expect(operation).resolves.toEqual({ status: 'cancelled' })
    expect(options.open).not.toHaveBeenCalled()
  })

  it('swallows an invalidated post-reset open rejection', async () => {
    const openDeferred = deferred<{ status: 'ok'; branchId: string }>()
    const options = request({ open: vi.fn(() => openDeferred.promise) })
    const coordinator = createStoryRecoveryCoordinator()
    const operation = coordinator.startReset(options)
    await vi.waitFor(() => expect(options.open).toHaveBeenCalledOnce())

    coordinator.invalidate()
    openDeferred.reject(new Error('obsolete open failure'))

    await expect(operation).resolves.toEqual({ status: 'cancelled' })
    expect(options.onOpened).not.toHaveBeenCalled()
    expect(options.onOpenFailed).not.toHaveBeenCalled()
  })

  it('keeps the same-story reset locked after invalidation until its operation settles', async () => {
    const firstReset = deferred<void>()
    const firstOptions = request({ reset: vi.fn(() => firstReset.promise) })
    const secondOptions = request()
    const coordinator = createStoryRecoveryCoordinator()

    const first = coordinator.startReset(firstOptions)
    coordinator.invalidate()
    const duplicate = coordinator.startReset(secondOptions)

    expect(duplicate).toBeUndefined()
    expect(secondOptions.reset).not.toHaveBeenCalled()

    firstReset.resolve(undefined)
    await first

    const laterOptions = request()
    const later = coordinator.startReset(laterOptions)
    expect(later).toBeInstanceOf(Promise)
    expect(laterOptions.reset).toHaveBeenCalledOnce()
    await later
  })

  it('prevents an older ordinary open from navigating or replacing a newer recovery', async () => {
    const openDeferred = deferred<{ status: 'cancelled' }>()
    let guardedNavigate: ((branchId: string) => void) | undefined
    let isCurrent: (() => boolean) | undefined
    const navigate = vi.fn()
    const onOpenFailed = vi.fn()
    const coordinator = createStoryRecoveryCoordinator()
    const ordinaryOpen = coordinator.attemptOpen({
      open: vi.fn((navigateToStory, current) => {
        guardedNavigate = navigateToStory
        isCurrent = current
        return openDeferred.promise
      }),
      navigate,
      onOpenFailed,
    })

    const newerRecovery = coordinator.startReset(request())
    expect(isCurrent?.()).toBe(false)
    guardedNavigate?.('br_old')
    openDeferred.resolve({ status: 'cancelled' })
    await ordinaryOpen
    await newerRecovery

    expect(navigate).not.toHaveBeenCalled()
    expect(onOpenFailed).not.toHaveBeenCalled()
  })

  it('swallows an ordinary-open rejection invalidated by a newer intent', async () => {
    const openDeferred = deferred<{ status: 'ok'; branchId: string }>()
    const onOpenFailed = vi.fn()
    const coordinator = createStoryRecoveryCoordinator()
    const operation = coordinator.attemptOpen({
      open: vi.fn(() => openDeferred.promise),
      navigate: vi.fn(),
      onOpenFailed,
    })

    coordinator.invalidate()
    openDeferred.reject(new Error('obsolete open failure'))

    await expect(operation).resolves.toBeUndefined()
    expect(onOpenFailed).not.toHaveBeenCalled()
  })

  it('preserves an ordinary-open rejection while its request is current', async () => {
    const failure = new Error('current open failure')
    const coordinator = createStoryRecoveryCoordinator()

    await expect(
      coordinator.attemptOpen({
        open: vi.fn().mockRejectedValue(failure),
        navigate: vi.fn(),
        onOpenFailed: vi.fn(),
      }),
    ).rejects.toBe(failure)
  })

  it('routes reset outcomes to the matching failure handler with the original error', () => {
    const resetError = new Error('reset failed')
    const reopenError = new Error('reopen failed')
    const onResetFailure = vi.fn()
    const onReopenFailure = vi.fn()

    handleStoryRecoveryResetOutcome(
      { status: 'failed', phase: 'reset', error: resetError },
      { onResetFailure, onReopenFailure },
    )
    handleStoryRecoveryResetOutcome(
      { status: 'failed', phase: 'reopen', error: reopenError },
      { onResetFailure, onReopenFailure },
    )
    handleStoryRecoveryResetOutcome({ status: 'cancelled' }, { onResetFailure, onReopenFailure })

    expect(onResetFailure).toHaveBeenCalledOnce()
    expect(onResetFailure).toHaveBeenCalledWith(resetError)
    expect(onReopenFailure).toHaveBeenCalledOnce()
    expect(onReopenFailure).toHaveBeenCalledWith(reopenError)
  })
})
