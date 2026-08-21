import { afterEach, describe, expect, it, vi } from 'vitest'

import { runInTransaction } from './transaction'

const OP = { sql: 'UPDATE stories SET title = ? WHERE id = ?', params: ['t', 's1'] }

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('runInTransaction', () => {
  // An empty op list is a normal outcome of the settings-op builders, not a
  // caller error, and BEGIN/COMMIT around nothing still costs a bridge IPC.
  it('does not reach the bridge for an empty op list', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined)
    globalThis.window = { aventurasDb: { transaction } } as unknown as Window & typeof globalThis

    await expect(runInTransaction([])).resolves.toBeUndefined()

    expect(transaction).not.toHaveBeenCalled()
  })

  it('sends a non-empty op list to the bridge', async () => {
    const transaction = vi.fn().mockResolvedValue(undefined)
    globalThis.window = { aventurasDb: { transaction } } as unknown as Window & typeof globalThis

    await runInTransaction([OP])

    expect(transaction).toHaveBeenCalledWith([OP])
  })

  // Pins that the empty check runs before the bridge is resolved: with no bridge
  // installed at all, resolveBridge throws, so a reached call cannot stay silent.
  it('returns for an empty op list even with no bridge installed', async () => {
    await expect(runInTransaction([])).resolves.toBeUndefined()
    await expect(runInTransaction([OP])).rejects.toThrow('Database bridge unavailable')
  })
})
