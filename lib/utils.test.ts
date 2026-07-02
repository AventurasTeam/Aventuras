import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runAction } from './utils'

const { errorSpy, toastErrorSpy } = vi.hoisted(() => ({
  errorSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
}))

vi.mock('@/lib/diagnostics', () => ({ logger: { error: errorSpy } }))
vi.mock('@/lib/toast', () => ({ toast: { error: toastErrorSpy } }))

// Let the rejected promise's catch microtask settle before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('runAction', () => {
  beforeEach(() => {
    errorSpy.mockClear()
    toastErrorSpy.mockClear()
  })

  it('logs and toasts on rejection, with context merged into the log', async () => {
    runAction(Promise.reject(new Error('boom')), {
      event: 'action_layer.story_delete_failed',
      toastMessage: 'Could not delete.',
      context: { storyId: 's1' },
    })
    await flush()

    expect(errorSpy).toHaveBeenCalledWith('action_layer.story_delete_failed', {
      storyId: 's1',
      error: 'boom',
    })
    expect(toastErrorSpy).toHaveBeenCalledWith('Could not delete.')
  })

  it('logs but does not toast when no message is given', async () => {
    runAction(Promise.reject(new Error('boom')), { event: 'action_layer.story_open_failed' })
    await flush()

    expect(errorSpy).toHaveBeenCalledOnce()
    expect(toastErrorSpy).not.toHaveBeenCalled()
  })

  it('stringifies a non-Error rejection', async () => {
    runAction(Promise.reject('plain'), { event: 'action_layer.story_open_failed' })
    await flush()

    expect(errorSpy).toHaveBeenCalledWith('action_layer.story_open_failed', { error: 'plain' })
  })

  it('does nothing on resolve', async () => {
    runAction(Promise.resolve('ok'), {
      event: 'action_layer.story_open_failed',
      toastMessage: 'unused',
    })
    await flush()

    expect(errorSpy).not.toHaveBeenCalled()
    expect(toastErrorSpy).not.toHaveBeenCalled()
  })
})
