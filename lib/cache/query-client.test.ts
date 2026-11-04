import { describe, expect, it } from 'vitest'

import { createQueryClient } from './query-client'

describe('app query client', () => {
  it('disables auto-refetch and never expires entries', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.staleTime).toBe(Infinity)
    expect(queries?.refetchOnWindowFocus).toBe(false)
    expect(queries?.refetchOnReconnect).toBe(false)
  })

  it('reads locally: runs offline, never retries, and collects an unused key after 30 s', () => {
    const queries = createQueryClient().getDefaultOptions().queries
    expect(queries?.networkMode).toBe('always')
    expect(queries?.retry).toBe(false)
    expect(queries?.gcTime).toBe(30_000)
  })
})
