import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { classifierExtractionSchema } from './schema'

describe('classifierExtractionSchema', () => {
  it('defaults every collection so a sparse reply still parses', () => {
    expect(classifierExtractionSchema.parse({})).toEqual({
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
    })
  })

  it('parses a happening with nested involvements and awareness', () => {
    const parsed = classifierExtractionSchema.parse({
      happenings: [
        {
          title: 'The courier is ambushed',
          description: 'Bandits take the satchel.',
          sourceTurn: 't2',
          occurredAtTurn: 't2',
          involvements: [{ ref: 'c1', role: 'victim' }],
          awareness: [
            { ref: 'c1', source: 'witnessed firsthand', severity: 0.9, learnedAtTurn: 't2' },
          ],
        },
      ],
    })
    expect(parsed.happenings[0].awareness[0].severity).toBe(0.9)
  })

  it("passes severity through unclamped - the clamp is the planner's job", () => {
    const parsed = classifierExtractionSchema.parse({
      happenings: [
        {
          title: 'x',
          sourceTurn: 't1',
          awareness: [{ ref: 'c1', source: 's', severity: 4 }],
        },
      ],
    })
    expect(parsed.happenings[0].awareness[0].severity).toBe(4)
  })

  it('defaults a missing severity to 0', () => {
    const parsed = classifierExtractionSchema.parse({
      happenings: [{ title: 'x', sourceTurn: 't1', awareness: [{ ref: 'c1', source: 's' }] }],
    })
    expect(parsed.happenings[0].awareness[0].severity).toBe(0)
  })

  it('accepts only the two canon status transitions', () => {
    expect(() =>
      classifierExtractionSchema.parse({
        statusFlips: [{ ref: 'c1', to: 'staged', sourceTurn: 't1' }],
      }),
    ).toThrow()
  })

  it('is representable as JSON schema for the structured call', () => {
    expect(() => z.toJSONSchema(classifierExtractionSchema)).not.toThrow()
  })

  it('has no commonKnowledge field (user-only per canon)', () => {
    const parsed = classifierExtractionSchema.parse({
      happenings: [{ title: 'x', sourceTurn: 't1', commonKnowledge: true }],
    })
    expect('commonKnowledge' in parsed.happenings[0]).toBe(false)
  })
})
