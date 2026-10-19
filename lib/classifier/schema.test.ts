import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  classifierExtractionSchema,
  classifierExtractionWithPlacesSchema,
  classifierReplySchema,
  newPlacesOf,
} from './schema'

describe('classifierExtractionSchema', () => {
  it('defaults every collection so a sparse reply still parses', () => {
    expect(classifierExtractionSchema.parse({})).toEqual({
      happenings: [],
      relationships: [],
      statusFlips: [],
      newCharacters: [],
      newFactions: [],
      memberships: [],
      aliases: [],
    })
  })

  it('parses a new faction, defaulting its keywords', () => {
    const parsed = classifierExtractionSchema.parse({
      newFactions: [
        { handle: 'new:circle', name: 'The Iron Circle', description: 'Smiths.', sourceTurn: 't1' },
      ],
    })
    expect(parsed.newFactions).toEqual([
      {
        handle: 'new:circle',
        name: 'The Iron Circle',
        description: 'Smiths.',
        keywords: [],
        sourceTurn: 't1',
      },
    ])
  })

  it('parses a membership to a faction or to none, and requires the faction key', () => {
    const parsed = classifierExtractionSchema.parse({
      memberships: [
        { character: 'c1', faction: 'new:circle', sourceTurn: 't1' },
        { character: 'new:mara', faction: null },
      ],
    })
    expect(parsed.memberships).toEqual([
      { character: 'c1', faction: 'new:circle', sourceTurn: 't1' },
      { character: 'new:mara', faction: null },
    ])
    expect(
      classifierExtractionSchema.safeParse({ memberships: [{ character: 'c1' }] }).success,
    ).toBe(false)
  })

  it('carries both lists in the places schema too', () => {
    expect(classifierExtractionWithPlacesSchema.parse({})).toMatchObject({
      newFactions: [],
      memberships: [],
    })
  })

  it('parses an alias entry, defaulting its terms', () => {
    const parsed = classifierExtractionSchema.parse({
      aliases: [{ ref: 'c1', terms: ['the Grey Wolf'], sourceTurn: 't2' }, { ref: 'l1' }],
    })
    expect(parsed.aliases).toEqual([
      { ref: 'c1', terms: ['the Grey Wolf'], sourceTurn: 't2' },
      { ref: 'l1', terms: [] },
    ])
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

describe('classifierExtractionWithPlacesSchema', () => {
  const place = { handle: 'new:varn', name: 'Varn', description: 'A salt town.', sourceTurn: 't1' }

  it('parses a new place, defaulting its keywords and leaving its parent optional', () => {
    const parsed = classifierExtractionWithPlacesSchema.parse({
      newPlaces: [
        place,
        { ...place, handle: 'new:inn', parent: 'new:varn', keywords: ['the inn'] },
      ],
    })
    expect(parsed.newPlaces).toEqual([
      { ...place, keywords: [] },
      { ...place, handle: 'new:inn', parent: 'new:varn', keywords: ['the inn'] },
    ])
    expect(classifierExtractionWithPlacesSchema.parse({}).newPlaces).toEqual([])
  })

  // The setting off sends the base schema, so a reply's places never reach the planner.
  it('is the only schema that keeps newPlaces', () => {
    expect('newPlaces' in classifierExtractionSchema.parse({ newPlaces: [place] })).toBe(false)
  })

  it('is representable as JSON schema for the structured call', () => {
    expect(() => z.toJSONSchema(classifierExtractionWithPlacesSchema)).not.toThrow()
  })
})

describe('classifierReplySchema', () => {
  it('asks for places only with the setting on', () => {
    expect(classifierReplySchema(true)).toBe(classifierExtractionWithPlacesSchema)
    expect(classifierReplySchema(false)).toBe(classifierExtractionSchema)
  })

  it('reads a reply under either schema as its new places', () => {
    const place = { handle: 'new:varn', name: 'Varn', description: '', keywords: [] }
    expect(newPlacesOf(classifierExtractionWithPlacesSchema.parse({ newPlaces: [place] }))).toEqual(
      [place],
    )
    expect(newPlacesOf(classifierExtractionSchema.parse({ newPlaces: [place] }))).toEqual([])
  })
})
