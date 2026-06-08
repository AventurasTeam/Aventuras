import { describe, expect, it } from 'vitest'

import { branchEraFlipWriteSchema } from './era-flip-schema'

describe('branchEraFlipWriteSchema', () => {
  it('parses a valid row (at_worldtime 0 is allowed)', () => {
    expect(branchEraFlipWriteSchema.safeParse({ atWorldtime: 0, eraName: 'Dawn' }).success).toBe(
      true,
    )
  })

  it('rejects a negative at_worldtime', () => {
    expect(branchEraFlipWriteSchema.safeParse({ atWorldtime: -1, eraName: 'Dawn' }).success).toBe(
      false,
    )
  })

  it('rejects a non-integer at_worldtime', () => {
    expect(branchEraFlipWriteSchema.safeParse({ atWorldtime: 1.5, eraName: 'Dawn' }).success).toBe(
      false,
    )
  })

  it('rejects a missing era_name', () => {
    expect(branchEraFlipWriteSchema.safeParse({ atWorldtime: 0 }).success).toBe(false)
  })
})
