// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'
import { toast } from '@/lib/toast'

import { useContentEditing } from './content-editing'

const updateStoryEntryContent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ status: string; reason?: string; code?: string }>>(),
)

vi.mock('@/lib/actions', () => ({ updateStoryEntryContent }))
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const CTX = {} as never

// Block body: `mockReset()` returns the mock, which beforeEach would register as a teardown.
beforeEach(() => {
  updateStoryEntryContent.mockReset()
  vi.mocked(toast.error).mockClear()
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function render(reload: () => Promise<void>) {
  return renderHook(() => useContentEditing('b1', CTX, reload)).result.current
}

describe('useContentEditing', () => {
  it('reports a rejected save as a result, with its code, and toasts', async () => {
    updateStoryEntryContent.mockResolvedValue({
      status: 'rejected',
      reason: 'generation in flight',
      code: 'in-flight-gated',
    })
    const reload = vi.fn(async () => {})

    await expect(render(reload)('e2', 'new')).resolves.toEqual({
      ok: false,
      code: 'in-flight-gated',
    })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(logger.warn).toHaveBeenCalledWith(
      'action_layer.content_edit_rejected',
      expect.objectContaining({ entryId: 'e2', code: 'in-flight-gated' }),
    )
    expect(reload).not.toHaveBeenCalled()
  })

  // The throw that matters commits the edit and then fails the store sync: without the
  // reload the store keeps the old prose and a second Save reads as unchanged.
  it('reports a thrown save as a result, toasts and resyncs the store', async () => {
    updateStoryEntryContent.mockRejectedValue(new Error('Post-commit replay patch sync failed'))
    const reload = vi.fn(async () => {})

    await expect(render(reload)('e2', 'new')).resolves.toEqual({ ok: false })
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'action_layer.content_edit_failed',
      expect.objectContaining({ entryId: 'e2', error: 'Post-commit replay patch sync failed' }),
    )
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('still resolves when the resync itself fails', async () => {
    updateStoryEntryContent.mockRejectedValue(new Error('database is locked'))
    const reload = vi.fn(async () => {
      throw new Error('read failed')
    })

    await expect(render(reload)('e2', 'new')).resolves.toEqual({ ok: false })
    expect(logger.error).toHaveBeenCalledWith(
      'action_layer.content_edit_resync_failed',
      expect.objectContaining({ error: 'read failed' }),
    )
  })

  it('reports a successful save as ok and stays quiet', async () => {
    updateStoryEntryContent.mockResolvedValue({ status: 'ok' })
    const reload = vi.fn(async () => {})

    await expect(render(reload)('e2', 'new')).resolves.toEqual({ ok: true })
    expect(toast.error).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
