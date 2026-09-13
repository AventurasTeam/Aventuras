import { describe, expect, it, vi } from 'vitest'

import { reportBootFailure } from './boot-failure'

describe('reportBootFailure', () => {
  it('shows the error, then exits non-zero so a relaunch is not refused', () => {
    const order: string[] = []
    const showErrorBox = vi.fn(() => order.push('dialog'))
    const exit = vi.fn(() => order.push('exit'))

    reportBootFailure(new Error('unable to open database file'), { showErrorBox, exit })

    expect(showErrorBox).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('unable to open database file'),
    )
    expect(exit).toHaveBeenCalledWith(1)
    expect(order).toEqual(['dialog', 'exit'])
  })

  it('reports a rejection that is not an Error', () => {
    const showErrorBox = vi.fn()

    reportBootFailure('boom', { showErrorBox, exit: vi.fn() })

    expect(showErrorBox).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('boom'))
  })
})
