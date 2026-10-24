import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  classifierExtractionSchema,
  classifierExtractionWithPlacesSchema,
  classifierReplySchema,
  newPlacesOf,
  readClassifierReply,
  type ParsedClassifierReply,
} from './schema'

type JsonNode = {
  properties?: Record<string, JsonNode>
  items?: JsonNode
  description?: string
  required?: string[]
}
const jsonOf = (schema: z.ZodType) => z.toJSONSchema(schema) as JsonNode
const itemFields = (list: string) =>
  jsonOf(classifierExtractionSchema).properties?.[list]?.items?.properties ?? {}

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
      renames: [],
      placements: [],
      standings: [],
      newThreads: [],
      threadStatuses: [],
      knownAwareness: [],
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

// classifier.md → What the classifier writes: first profiles, and updates to listed rows.
describe('classifierExtractionSchema — the writer map', () => {
  it("parses a new character's and a new faction's first profile, every part optional", () => {
    const parsed = classifierExtractionSchema.parse({
      newCharacters: [
        {
          handle: 'new:mira',
          name: 'Mira',
          description: 'A ferrywoman.',
          visual: { hair: 'salt-white braid', attire: 'oilskin coat' },
          traits: ['wary'],
          drives: ['keep the ferry running'],
          voice: 'clipped, dry',
        },
        { handle: 'new:bren', name: 'Bren', description: 'A boy.' },
      ],
      newFactions: [
        {
          handle: 'new:circle',
          name: 'The Iron Circle',
          description: 'Smiths.',
          standing: 'outlawed',
          agenda: ['take the mines'],
        },
      ],
    })
    expect(parsed.newCharacters[0]).toMatchObject({
      visual: { hair: 'salt-white braid', attire: 'oilskin coat' },
      traits: ['wary'],
      drives: ['keep the ferry running'],
      voice: 'clipped, dry',
    })
    expect(parsed.newCharacters[1]).toEqual({
      handle: 'new:bren',
      name: 'Bren',
      description: 'A boy.',
      keywords: [],
    })
    expect(parsed.newFactions[0]).toMatchObject({
      standing: 'outlawed',
      agenda: ['take the mines'],
    })
  })

  it("parses a happening's category and icon, and keeps an icon outside the catalog", () => {
    const parsed = classifierExtractionSchema.parse({
      happenings: [
        { title: 'The ford ambush', category: 'battle', icon: 'swords' },
        { title: 'A lamp lit', icon: 'lantern' },
      ],
    })
    expect(parsed.happenings.map((h) => [h.category, h.icon])).toEqual([
      ['battle', 'swords'],
      [undefined, 'lantern'],
    ])
  })

  // Free string: an off-catalog key still parses (the planner drops it); description lists keys.
  it("lists the catalog's keys in the icon's description, on happenings and new threads", () => {
    const expected =
      'One of: sparkles, eye, handshake, door, swords, flame, mask, scroll, key, skull, crown, map, heart, shield, coins, book. Omit when none fits.'
    expect(itemFields('happenings').icon?.description).toBe(expected)
    expect(itemFields('newThreads').icon?.description).toBe(expected)
  })

  it('parses renames, placements and standings of listed rows', () => {
    const parsed = classifierExtractionSchema.parse({
      renames: [{ ref: 'c1', name: 'Mira', sourceTurn: 't2' }],
      placements: [
        { ref: 'l2', parent: 'l1', sourceTurn: 't1' },
        { ref: 'l3', parent: 'top-level' },
      ],
      standings: [{ ref: 'f1', standing: 'at war with the crown', sourceTurn: 't3' }],
    })
    expect(parsed.renames).toEqual([{ ref: 'c1', name: 'Mira', sourceTurn: 't2' }])
    expect(parsed.placements).toEqual([
      { ref: 'l2', parent: 'l1', sourceTurn: 't1' },
      { ref: 'l3', parent: 'top-level' },
    ])
    expect(parsed.standings).toEqual([
      { ref: 'f1', standing: 'at war with the crown', sourceTurn: 't3' },
    ])
  })

  // Required-vs-optional reaches the model as the prompt's TS block, so each key is pinned.
  const REQUIRED_KEYS = {
    renames: { item: { ref: 'c1', name: 'Mira' }, keys: ['ref', 'name'] },
    placements: { item: { ref: 'l2', parent: 'l1' }, keys: ['ref', 'parent'] },
    standings: { item: { ref: 'f1', standing: 'outlawed' }, keys: ['ref', 'standing'] },
    newThreads: {
      item: { title: 'Recover the relic', description: 'Stolen.', status: 'active' },
      keys: ['title', 'description', 'status'],
    },
    threadStatuses: { item: { thread: 'th1', status: 'resolved' }, keys: ['thread', 'status'] },
    knownAwareness: {
      item: { happening: 'hp1', ref: 'c2', source: 'told by Jorin' },
      keys: ['happening', 'ref', 'source'],
    },
  } as const

  // classifier.md → Failure policy: the model is told every key, and a reply is read leniently.
  it.each(Object.entries(REQUIRED_KEYS))(
    'asks for every required key of a %s entry, and drops one missing any, counted',
    (list, { item, keys }) => {
      expect(jsonOf(classifierExtractionSchema).properties?.[list]?.items?.required).toEqual(
        expect.arrayContaining([...keys]),
      )
      const read = (entries: unknown[]) =>
        readClassifierReply(classifierExtractionSchema.parse({ [list]: entries }))
      expect(read([item]).reply[list as keyof typeof REQUIRED_KEYS], 'whole').toHaveLength(1)
      for (const key of keys) {
        const { [key as keyof typeof item]: _dropped, ...rest } = item
        const { reply, malformed } = read([rest, item])
        expect(reply[list as keyof typeof REQUIRED_KEYS], key).toEqual([
          expect.objectContaining(item),
        ])
        expect(malformed, key).toEqual([{ list, count: 1 }])
      }
    },
  )

  it("tells the model a placement's parent may be the top-level token", () => {
    expect(itemFields('placements').parent?.description).toContain(
      'or "top-level" for an unplaced place',
    )
  })

  // classifier.md → Threads → What it emits: opened and closed in one window arrives already
  // resolved or failed, since no later pass sees the closing turn.
  it('takes a new thread in any of the four statuses, and a status change never to pending', () => {
    const thread = { title: 'Recover the relic', description: 'Stolen at the ford.' }
    expect(
      classifierExtractionSchema
        .parse({
          newThreads: (['pending', 'active', 'resolved', 'failed'] as const).map((status) => ({
            ...thread,
            status,
          })),
        })
        .newThreads.map((t) => t?.status),
    ).toEqual(['pending', 'active', 'resolved', 'failed'])
    expect(
      classifierExtractionSchema.parse({
        newThreads: [{ ...thread, status: 'resolved', sourceTurn: 't1', resolvedAtTurn: 't4' }],
      }).newThreads,
    ).toEqual([{ ...thread, status: 'resolved', sourceTurn: 't1', resolvedAtTurn: 't4' }])
    expect(
      readClassifierReply(
        classifierExtractionSchema.parse({
          newThreads: [
            { ...thread, status: 'paused' },
            { ...thread, status: 'on hold' },
          ],
        }),
      ),
    ).toMatchObject({ reply: { newThreads: [] }, malformed: [{ list: 'newThreads', count: 2 }] })
    expect(
      classifierExtractionSchema
        .parse({
          threadStatuses: [
            { thread: 'th1', status: 'resolved' },
            { thread: 'th2', status: 'failed' },
            { thread: 'th3', status: 'active' },
          ],
        })
        .threadStatuses.map((t) => t?.status),
    ).toEqual(['resolved', 'failed', 'active'])
    expect(
      readClassifierReply(
        classifierExtractionSchema.parse({
          threadStatuses: [{ thread: 'th1', status: 'pending' }],
        }),
      ),
    ).toMatchObject({
      reply: { threadStatuses: [] },
      malformed: [{ list: 'threadStatuses', count: 1 }],
    })
  })

  it('tells the model when a new thread may be resolved or failed, and which turn is which', () => {
    const fields = itemFields('newThreads')
    expect(fields.status?.description).toContain('only for a thread the turns both open and close')
    expect(fields.resolvedAtTurn?.description).toContain('when the turns both open and close it')
    expect(fields.resolvedAtTurn?.description).toContain('sourceTurn stays the turn that opened it')
  })

  // The schema block ends the system message, before the turns: "these turns" has no referent.
  it.each([
    ['classifierExtractionSchema', classifierExtractionSchema],
    ['classifierExtractionWithPlacesSchema', classifierExtractionWithPlacesSchema],
  ])('never says "these turns" in the %s block', (_name, schema) => {
    expect(JSON.stringify(z.toJSONSchema(schema))).not.toMatch(/these turns/i)
  })

  it('parses awareness of a listed happening, defaulting its severity to 0', () => {
    const parsed = classifierExtractionSchema.parse({
      knownAwareness: [
        { happening: 'hp1', ref: 'c2', source: 'told by Jorin', learnedAtTurn: 't2' },
      ],
    })
    expect(parsed.knownAwareness).toEqual([
      { happening: 'hp1', ref: 'c2', source: 'told by Jorin', severity: 0, learnedAtTurn: 't2' },
    ])
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

  it("parses a new place's condition", () => {
    const parsed = classifierExtractionWithPlacesSchema.parse({
      newPlaces: [{ ...place, condition: 'half flooded' }],
    })
    expect(parsed.newPlaces[0].condition).toBe('half flooded')
  })

  // The setting off sends the base schema, so a reply's places never reach the planner.
  it('is the only schema that keeps newPlaces', () => {
    expect('newPlaces' in classifierExtractionSchema.parse({ newPlaces: [place] })).toBe(false)
  })

  it('is representable as JSON schema for the structured call', () => {
    expect(() => z.toJSONSchema(classifierExtractionWithPlacesSchema)).not.toThrow()
  })

  // classifier.md → Mentioned places → Parent: a parent, "top-level", or none for unplaced.
  it('tells the model when a new place is top-level and when to leave its parent out', () => {
    const json = z.toJSONSchema(classifierExtractionWithPlacesSchema) as unknown as {
      properties: {
        newPlaces: { items: { properties: { parent: { description?: string } } } }
      }
    }
    const { description } = json.properties.newPlaces.items.properties.parent
    expect(description).toContain('"top-level" only when nothing in Places could contain it')
    expect(description).toContain(
      "Omit it when something in Places could contain it and the turns don't say which",
    )
  })
})

// classifier.md → Failure policy: a failed parse fails the pass, so these read as absent.
describe('optional profile and plot fields the model fills wrongly', () => {
  const ITEMS = {
    newCharacters: { handle: 'new:mira', name: 'Mira', description: 'A ferrywoman.' },
    newFactions: { handle: 'new:circle', name: 'The Iron Circle', description: 'Smiths.' },
    happenings: { title: 'The ford ambush' },
    newThreads: { title: 'Recover the relic', description: 'Stolen.', status: 'resolved' },
    newPlaces: { handle: 'new:varn', name: 'Varn', description: 'A salt town.' },
  } as const
  type List = keyof typeof ITEMS
  const FIELDS: [List, string][] = [
    ['newCharacters', 'visual'],
    ['newCharacters', 'traits'],
    ['newCharacters', 'drives'],
    ['newCharacters', 'voice'],
    ['newFactions', 'standing'],
    ['newFactions', 'agenda'],
    ['happenings', 'category'],
    ['happenings', 'icon'],
    ['newThreads', 'category'],
    ['newThreads', 'icon'],
    ['newThreads', 'resolvedAtTurn'],
    ['newPlaces', 'condition'],
  ]
  const parsedItem = (list: List, item: Record<string, unknown>) => {
    const result = classifierExtractionWithPlacesSchema.safeParse({ [list]: [item] })
    expect(result.success).toBe(true)
    return (result.data?.[list] as Record<string, unknown>[] | undefined)?.[0]
  }

  it.each(FIELDS)('reads a null %s %s as absent, keeping the entry', (list, field) => {
    const item = parsedItem(list, { ...ITEMS[list], [field]: null })
    expect(item).toMatchObject(ITEMS[list])
    expect(item?.[field]).toBeUndefined()
  })

  it.each(FIELDS)('reads a %s %s of the wrong type as absent', (list, field) => {
    const wrong = field === 'traits' || field === 'drives' || field === 'agenda' ? 'one' : [1]
    expect(parsedItem(list, { ...ITEMS[list], [field]: wrong })?.[field]).toBeUndefined()
  })

  it.each(['physique', 'face', 'hair', 'eyes', 'attire', 'distinguishing'])(
    "reads a null visual %s as absent, keeping the character's other categories",
    (key) => {
      const other = key === 'eyes' ? 'hair' : 'eyes'
      const item = parsedItem('newCharacters', {
        ...ITEMS.newCharacters,
        visual: { [key]: null, [other]: 'grey' },
      })
      expect(item?.visual).toEqual({ [other]: 'grey' })
    },
  )
})

// classifier.md → Failure policy: the writer map's lists drop an entry that doesn't fit alone.
describe('an entry of a writer-map list that does not fit', () => {
  const MALFORMED = {
    renames: { ref: 'c1', name: 7 },
    placements: { ref: 'l2', parent: ['l1'] },
    standings: { ref: 'f1' },
    newThreads: { title: 'Recover the relic', description: 'Stolen.', status: 'paused' },
    threadStatuses: { thread: 'th1', status: 'pending' },
    knownAwareness: { happening: 'hp1', ref: 'c2', source: 'told', severity: 'high' },
  } as const
  const WELL_FORMED = {
    renames: { ref: 'c2', name: 'Mira' },
    placements: { ref: 'l3', parent: 'l1' },
    standings: { ref: 'f2', standing: 'outlawed' },
    newThreads: { title: 'Find the ford', description: 'Lost.', status: 'active' },
    threadStatuses: { thread: 'th2', status: 'resolved' },
    knownAwareness: { happening: 'hp2', ref: 'c3', source: 'saw it', severity: 0 },
  } as const
  type List = keyof typeof MALFORMED

  it.each(Object.keys(MALFORMED) as List[])(
    'drops a malformed %s entry alone, counted, and keeps the rest of the reply',
    (list) => {
      const parsed = classifierExtractionWithPlacesSchema.safeParse({
        [list]: [MALFORMED[list], WELL_FORMED[list], 'not an entry'],
        relationships: [{ subject: 'c1', object: 'c2', kind: 'trusts' }],
      })
      expect(parsed.success).toBe(true)
      const { reply, malformed } = readClassifierReply(parsed.data!)
      expect(reply[list]).toEqual([WELL_FORMED[list]])
      expect(reply.relationships).toHaveLength(1)
      expect(malformed).toEqual([{ list, count: 2 }])
    },
  )

  // Q28: a status the model capitalised or padded lands; one outside the list still drops.
  it('reads a status trimmed and case-folded, and still drops one outside the list', () => {
    const thread = { title: 'Recover the relic', description: 'Stolen.' }
    const { reply, malformed } = readClassifierReply(
      classifierExtractionSchema.parse({
        newThreads: [
          { ...thread, status: 'Resolved' },
          { ...thread, status: ' ACTIVE ' },
        ],
        threadStatuses: [
          { thread: 'th1', status: 'Failed' },
          { thread: 'th2', status: 'Pending' },
        ],
      }),
    )
    expect(reply.newThreads.map((t) => t.status)).toEqual(['resolved', 'active'])
    expect(reply.threadStatuses).toEqual([{ thread: 'th1', status: 'failed' }])
    expect(malformed).toEqual([{ list: 'threadStatuses', count: 1 }])
  })

  it('reads a null field as absent before it judges the entry', () => {
    const { reply, malformed } = readClassifierReply(
      classifierExtractionSchema.parse({
        renames: [{ ref: 'c1', name: 'Mira', sourceTurn: null }],
        threadStatuses: [{ thread: 'th1', status: 'failed', sourceTurn: null }],
        standings: [{ ref: 'f1', standing: null }],
      }),
    )
    expect(reply.renames).toEqual([{ ref: 'c1', name: 'Mira' }])
    expect(reply.threadStatuses).toEqual([{ thread: 'th1', status: 'failed' }])
    expect(malformed).toEqual([{ list: 'standings', count: 1 }])
  })

  it('reads a null list as empty, and still fails a null older list', () => {
    const lists = Object.fromEntries(Object.keys(MALFORMED).map((list) => [list, null]))
    const parsed = classifierExtractionSchema.safeParse(lists)
    expect(parsed.success).toBe(true)
    const { reply, malformed } = readClassifierReply(parsed.data!)
    for (const list of Object.keys(MALFORMED) as List[]) expect(reply[list], list).toEqual([])
    expect(malformed).toEqual([])
    expect(classifierExtractionSchema.safeParse({ statusFlips: null }).success).toBe(false)
  })

  it('counts nothing for a reply whose entries all fit', () => {
    const lists = Object.fromEntries(
      Object.entries(WELL_FORMED).map(([list, entry]) => [list, [entry]]),
    )
    expect(readClassifierReply(classifierExtractionSchema.parse(lists)).malformed).toEqual([])
  })

  it('still fails the reply on a malformed entry of an older list', () => {
    expect(
      classifierExtractionSchema.safeParse({ statusFlips: [{ ref: 'c1', to: 'staged' }] }).success,
    ).toBe(false)
  })
})

describe('classifierReplySchema', () => {
  it('asks for places only with the setting on', () => {
    expect(classifierReplySchema(true)).toBe(classifierExtractionWithPlacesSchema)
    expect(classifierReplySchema(false)).toBe(classifierExtractionSchema)
  })

  it('reads a reply under either schema as its new places', () => {
    const place = { handle: 'new:varn', name: 'Varn', description: '', keywords: [] }
    const read = (schema: z.ZodType<ParsedClassifierReply>) =>
      newPlacesOf(readClassifierReply(schema.parse({ newPlaces: [place] })).reply)
    expect(read(classifierExtractionWithPlacesSchema)).toEqual([place])
    expect(read(classifierExtractionSchema)).toEqual([])
  })
})
