import { afterEach, describe, expect, it, vi } from 'vitest'

import { db } from './client'
import { branches, stories } from '../schema'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the desktop client', () => {
  it('sends a batch as one bridge call and no single query', async () => {
    const query = vi.fn()
    const batch = vi.fn().mockResolvedValue([{ rows: [] }, { rows: [] }])
    vi.stubGlobal('window', { aventurasDb: { query, batch } })

    const answer = await db.batch([db.select().from(stories), db.select().from(branches)])

    expect(answer).toEqual([[], []])
    expect(batch).toHaveBeenCalledTimes(1)
    expect(batch).toHaveBeenCalledWith([
      { sql: expect.stringContaining('from "stories"'), params: [], method: 'all' },
      { sql: expect.stringContaining('from "branches"'), params: [], method: 'all' },
    ])
    expect(query).not.toHaveBeenCalled()
  })
})
