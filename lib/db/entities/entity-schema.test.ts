import { describe, expect, it } from 'vitest'

import { entityWriteSchema } from './entity-schema'

describe('entityWriteSchema', () => {
  // drizzle-zod types a JSON column loosely; without the explicit array override
  // any shape parses and the column round-trips garbage.
  it('rejects a non-array keywords value', () => {
    expect(entityWriteSchema.partial().safeParse({ keywords: 'grey wolf' }).success).toBe(false)
    expect(entityWriteSchema.partial().safeParse({ keywords: [1, 2] }).success).toBe(false)
  })

  it('accepts a string array and an integer priority', () => {
    expect(
      entityWriteSchema.partial().safeParse({ keywords: ['the grey wolf'], priority: 3 }).success,
    ).toBe(true)
  })
})
