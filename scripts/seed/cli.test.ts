import { describe, expect, it } from 'vitest'

import { parseCli } from './cli'

const DEFAULTS = { path: undefined, longBranch: false, dataset: false, overlay: false }

describe('parseCli', () => {
  it('reads each seed the package scripts run, with or without a database path', () => {
    expect(parseCli([])).toEqual(DEFAULTS)
    expect(parseCli(['/tmp/a.db'])).toEqual({ ...DEFAULTS, path: '/tmp/a.db' })
    expect(parseCli(['--long-branch'])).toEqual({ ...DEFAULTS, longBranch: true })
    expect(parseCli(['--dataset', '/tmp/a.db'])).toEqual({
      ...DEFAULTS,
      dataset: true,
      path: '/tmp/a.db',
    })
  })

  it('takes --overlay on the dataset seed, in either order', () => {
    const overlaid = { ...DEFAULTS, dataset: true, overlay: true }
    expect(parseCli(['--dataset', '--overlay'])).toEqual(overlaid)
    expect(parseCli(['--overlay', '--dataset'])).toEqual(overlaid)
  })

  it('refuses --overlay without --dataset', () => {
    expect(() => parseCli(['--overlay'])).toThrow(/--overlay goes on the dataset seed/)
    expect(() => parseCli(['--long-branch', '--overlay', '/tmp/a.db'])).toThrow(
      /--overlay goes on the dataset seed/,
    )
  })

  it('refuses a second database path and an unknown flag', () => {
    expect(() => parseCli(['/tmp/a.db', '/tmp/b.db'])).toThrow(/one database path at most, got 2/)
    expect(() => parseCli(['--datset'])).toThrow(/--datset/)
  })
})
