import { describe, expect, it, vi } from 'vitest'

import { createStoryRecoveryCoordinator } from './story-recovery-coordinator'

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

  it('keeps reset rejection available to runAction', async () => {
    const failure = new Error('reset failed')
    const options = request({ reset: vi.fn().mockRejectedValue(failure) })
    const coordinator = createStoryRecoveryCoordinator()

    await expect(coordinator.startReset(options)).rejects.toBe(failure)

    expect(options.open).not.toHaveBeenCalled()

    const retryOptions = request()
    await coordinator.startReset(retryOptions)
    expect(retryOptions.reset).toHaveBeenCalledOnce()
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
})
