// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'
import { resetAllStores } from '@/lib/stores'

import { useColdOpenStory } from './use-cold-open-story'

const mocks = vi.hoisted(() => ({ load: vi.fn(), leave: vi.fn() }))

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))
vi.mock('@/lib/actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadOpenStory: mocks.load,
}))
vi.mock('@/lib/stores', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  rehydrateStories: () => Promise.resolve(),
}))
vi.mock('./use-leave-failed-story-open', () => ({ useLeaveFailedStoryOpen: () => mocks.leave }))

function Probe({ branchId }: { branchId: string }) {
  useColdOpenStory(branchId, 'plot')
  return null
}

describe('useColdOpenStory', () => {
  beforeEach(() => {
    resetAllStores()
    mocks.load.mockReset()
    mocks.leave.mockReset()
  })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('leaves and logs a branch that has no story', async () => {
    const warn = vi.spyOn(logger, 'warn')
    mocks.load.mockResolvedValue({ status: 'no-story' })
    render(<Probe branchId="br_gone" />)
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledOnce())
    expect(warn).toHaveBeenCalledWith('app.plot_story_not_found', { branchId: 'br_gone' })
  })

  it('leaves without a second log when the open failed where it was detected', async () => {
    const warn = vi.spyOn(logger, 'warn')
    mocks.load.mockResolvedValue({ status: 'failed', kind: 'definition-corrupt' })
    render(<Probe branchId="br_1" />)
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledOnce())
    expect(warn).not.toHaveBeenCalled()
  })

  it('leaves and logs a rejected load', async () => {
    const error = vi.spyOn(logger, 'error')
    mocks.load.mockRejectedValue(new Error('bridge down'))
    render(<Probe branchId="br_1" />)
    await waitFor(() => expect(mocks.leave).toHaveBeenCalledOnce())
    expect(error).toHaveBeenCalledWith('app.plot_story_load_failed', {
      branchId: 'br_1',
      error: 'bridge down',
    })
  })

  it('leaves and logs an empty branch id without loading', () => {
    const warn = vi.spyOn(logger, 'warn')
    render(<Probe branchId="" />)
    expect(mocks.leave).toHaveBeenCalledOnce()
    expect(mocks.load).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('app.plot_story_not_found', { branchId: '' })
  })

  it('does not leave once the load is cancelled by an unmount', async () => {
    let resolve: (value: { status: 'no-story' }) => void = () => {}
    mocks.load.mockReturnValue(new Promise((r) => (resolve = r)))
    const { unmount } = render(<Probe branchId="br_1" />)
    unmount()
    resolve({ status: 'no-story' })
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.leave).not.toHaveBeenCalled()
  })
})
