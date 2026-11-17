import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { chapterBoundarySchema, refineBoundaryReply } from './chapter-boundary-schema'

const HANDLES = new Set(['t1', 't2'])

// chapter-close.md → Phase 1's output: a candidate's turn id and one sentence.
describe('chapterBoundarySchema', () => {
  it('reads a turn id and a rationale', () => {
    expect(
      chapterBoundarySchema.parse({ end_entry_id: 't2', rationale: 'The scene ends at the ford.' }),
    ).toEqual({ end_entry_id: 't2', rationale: 'The scene ends at the ford.' })
  })

  it('takes any turn id: the call refines it', () => {
    expect(chapterBoundarySchema.safeParse({ end_entry_id: 't9', rationale: 'r' }).success).toBe(
      true,
    )
  })
})

describe('refineBoundaryReply', () => {
  it("accepts a reply naming one of the call's turns", () => {
    expect(refineBoundaryReply(HANDLES).parse({ end_entry_id: 't2', rationale: 'r' })).toEqual({
      end_entry_id: 't2',
      rationale: 'r',
    })
  })

  it('refuses any other turn id, naming the listed ones', () => {
    const result = refineBoundaryReply(HANDLES).safeParse({ end_entry_id: 't3', rationale: 'r' })
    expect(result.success).toBe(false)
    expect(result.error?.issues).toEqual([
      {
        code: 'custom',
        path: ['end_entry_id'],
        message: 'end_entry_id must be one of the listed turns: t1, t2',
      },
    ])
  })

  it('refuses a reply that misses a field, as the plain schema does', () => {
    expect(refineBoundaryReply(HANDLES).safeParse({ end_entry_id: 't1' }).success).toBe(false)
  })

  // AC3: the block the app injects is rendered from this JSON Schema, and the mock matches it
  // against the plain schema's block.
  it("renders the plain schema's JSON Schema, whatever the call's turns", () => {
    expect(z.toJSONSchema(refineBoundaryReply(new Set(['t1'])))).toEqual(
      z.toJSONSchema(chapterBoundarySchema),
    )
    expect(z.toJSONSchema(refineBoundaryReply(HANDLES))).toEqual(
      z.toJSONSchema(chapterBoundarySchema),
    )
  })
})
