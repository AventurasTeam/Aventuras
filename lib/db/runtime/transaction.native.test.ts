import { beforeEach, describe, expect, it, vi } from 'vitest'

// Kept out of transaction.test.ts: eslint's resolver maps `./transaction` and
// `./transaction.native` alike, so import/no-duplicates aliases this one to web.
import { runInTransaction } from './transaction.native'

const withTransactionSync = vi.fn((fn: () => void) => fn())
const runSync = vi.fn()

vi.mock('./client.native', () => ({
  get expoDb() {
    return { withTransactionSync, runSync }
  },
}))

const OP = { sql: 'UPDATE stories SET title = ? WHERE id = ?', params: ['t', 's1'] }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runInTransaction (native)', () => {
  it('does not open a transaction for an empty op list', async () => {
    await expect(runInTransaction([])).resolves.toBeUndefined()

    expect(withTransactionSync).not.toHaveBeenCalled()
  })

  it('opens a transaction for a non-empty op list', async () => {
    await runInTransaction([OP])

    expect(withTransactionSync).toHaveBeenCalledOnce()
    expect(runSync).toHaveBeenCalledWith(OP.sql, ...OP.params)
  })
})
