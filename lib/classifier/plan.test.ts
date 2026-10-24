import { describe, expect, it } from 'vitest'

import type { Entity } from '@/lib/db'

import { buildClassifierActions, clampEmbeddedCharacter, type PlannedWrite } from './plan'
import type { ReconcileDecision } from './reconcile'
import type { ClassifierExtraction, ClassifierPlacesExtraction, NewPlace } from './schema'
import { buildClassifierWindow } from './window'

// `.find()` / `.filter()` on action.kind doesn't narrow the PipelineAction union,
// so payload reads go through here rather than per-assertion casts.
const payloadOf = <T>(p: PlannedWrite | undefined) => p?.action.payload as unknown as T

const entry = (position: number, id: string) =>
  ({ id, position, kind: 'ai_reply', content: `prose ${position}` }) as never

const window = () =>
  buildClassifierWindow({
    entries: [entry(1, 'e1'), entry(2, 'e2'), entry(3, 'e3')],
    processedThrough: 0,
    maxEntries: 20,
  })

// Minimal entity fixture: the planner reads only id / kind / name / status / keywords.
const entityRow = (id: string, status = 'active', name = id, keywords: string[] = []) =>
  ({
    id,
    branchId: 'branch_1',
    kind: 'character',
    name,
    description: 'x',
    status,
    keywords,
  }) as never

const nonCharacterRow = (id: string, kind: string) =>
  ({
    id,
    branchId: 'branch_1',
    kind,
    name: id,
    description: 'x',
    status: 'active',
    keywords: [],
  }) as never

const base = {
  branchId: 'branch_1',
  window: window(),
  entities: [
    entityRow('char_a'),
    entityRow('char_b'),
    entityRow('char_kael'),
    entityRow('char_aria'),
  ] as never[],
  decisions: new Map(),
  factionDecisions: new Map(),
  now: () => 1_700_000_000_000,
  newId: (() => {
    let n = 0
    return () => `gen_${++n}`
  })(),
  threads: [],
  happenings: [],
  awareness: [],
}

// The reply schema defaults every list to []: a case names only the lists it fills.
const reply = (over: Partial<ClassifierPlacesExtraction> = {}): ClassifierPlacesExtraction => ({
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
  newPlaces: [],
  ...over,
})

describe('buildClassifierActions', () => {
  it('anchors each fact to its own source turn', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
          { title: 'B', sourceTurn: 't3', involvements: [], awareness: [] },
        ],
      }),
      base,
    )
    const anchors = planned.filter((p) => p.action.kind === 'createHappening').map((p) => p.entryId)
    expect(anchors).toEqual(['e1', 'e3'])
  })

  it('falls back to the window head for an unattributed fact and reports it', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      reply({ happenings: [{ title: 'A', involvements: [], awareness: [] }] }),
      base,
    )
    expect(planned[0].entryId).toBe('e3')
    expect(fellBackCount).toBe(1)
  })

  it('gives involvements their parent anchor and awareness its own learning turn', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            sourceTurn: 't1',
            involvements: [{ ref: 'char_a' }],
            awareness: [
              { ref: 'char_a', source: 'told by Jorin', severity: 0.8, learnedAtTurn: 't3' },
            ],
          },
        ],
      }),
      base,
    )
    const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
    const awareness = planned.find((p) => p.action.kind === 'upsertHappeningAwareness')
    expect(involvement?.entryId).toBe('e1')
    expect(awareness?.entryId).toBe('e3')
  })

  it('stores blank free text as absent rather than an empty string', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            description: '  ',
            temporal: '',
            sourceTurn: 't1',
            involvements: [{ ref: 'char_a', role: ' ' }],
            awareness: [{ ref: 'char_b', source: '', severity: 0.5 }],
          },
        ],
        statusFlips: [{ ref: 'char_kael', to: 'retired', reason: '\n', sourceTurn: 't2' }],
      }),
      base,
    )
    const byKind = (kind: string) => planned.find((p) => p.action.kind === kind)
    expect(payloadOf<{ entry: object }>(byKind('createHappening')).entry).toMatchObject({
      description: null,
      temporal: null,
    })
    expect(payloadOf<{ entry: object }>(byKind('createHappeningInvolvement')).entry).toMatchObject({
      role: null,
    })
    expect(
      payloadOf<{ source?: string }>(byKind('upsertHappeningAwareness')).source,
    ).toBeUndefined()
    expect(
      payloadOf<{ retiredReason: string | null }>(byKind('retireEntity')).retiredReason,
    ).toBeNull()
  })

  it('drops a happening whose title is blank, along with the rows nested under it', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: ' \n',
            involvements: [{ ref: 'char_a' }],
            awareness: [{ ref: 'char_b', source: 'saw it', severity: 0.5 }],
          },
          { title: 'B', sourceTurn: 't1', involvements: [], awareness: [] },
        ],
      }),
      base,
    )
    expect(planned.map((p) => p.action.kind)).toEqual(['createHappening'])
    expect(payloadOf<{ entry: { title: string } }>(planned[0]).entry.title).toBe('B')
    expect(fellBackCount).toBe(0)
  })

  it('trims the whitespace around a happening title', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [{ title: '  The ford  ', sourceTurn: 't1', involvements: [], awareness: [] }],
      }),
      base,
    )
    expect(payloadOf<{ entry: { title: string } }>(planned[0]).entry.title).toBe('The ford')
  })

  it('clamps an out-of-range severity into [0, 1]', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            sourceTurn: 't1',
            involvements: [],
            awareness: [
              { ref: 'char_a', source: 's', severity: 4 },
              { ref: 'char_b', source: 's', severity: -2 },
            ],
          },
        ],
      }),
      { ...base, entities: [entityRow('char_a'), entityRow('char_b')] },
    )
    const resistances = planned
      .filter((p) => p.action.kind === 'upsertHappeningAwareness')
      .map((p) => payloadOf<{ decayResistance: number }>(p).decayResistance)
    expect(resistances).toEqual([1, 0])
  })

  it('maps severity onto decay_resistance and stamps learned_at_entry_id', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            sourceTurn: 't2',
            involvements: [],
            awareness: [{ ref: 'char_a', source: 'witnessed firsthand', severity: 0.9 }],
          },
        ],
      }),
      base,
    )
    const awareness = planned.find((p) => p.action.kind === 'upsertHappeningAwareness')
    expect(awareness?.action.payload).toMatchObject({
      characterId: 'char_a',
      decayResistance: 0.9,
      learnedAtEntryId: 'e2',
      source: 'witnessed firsthand',
    })
  })

  it('creates happenings embedding_stale with no vec0 work', () => {
    const { planned } = buildClassifierActions(
      reply({ happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }] }),
      base,
    )
    expect(payloadOf<{ entry: { embeddingStale: number } }>(planned[0]).entry.embeddingStale).toBe(
      1,
    )
  })

  it('emits relationships as (subject, object, kind) for the action to normalize', () => {
    const { planned } = buildClassifierActions(
      reply({
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: 'sister', sourceTurn: 't1' },
        ],
      }),
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: { subjectId: 'char_kael', objectId: 'char_aria', kind: 'sister' },
    })
  })

  it('plans nothing for a relationship whose kind is blank', () => {
    const { planned } = buildClassifierActions(
      reply({
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: '   ', sourceTurn: 't1' },
        ],
      }),
      base,
    )
    expect(planned).toEqual([])
  })

  it('trims a relationship kind before writing it', () => {
    const { planned } = buildClassifierActions(
      reply({
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: ' ally ', sourceTurn: 't1' },
        ],
      }),
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'upsertCharacterRelationship',
      payload: { kind: 'ally' },
    })
  })

  it('writes a retirement only for the retired transition and carries the reason', () => {
    const { planned } = buildClassifierActions(
      reply({
        statusFlips: [
          { ref: 'char_kael', to: 'retired', reason: 'killed at the ford', sourceTurn: 't2' },
        ],
      }),
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'retireEntity',
      payload: { id: 'char_kael', retiredReason: 'killed at the ford' },
    })
    expect(planned[0].entryId).toBe('e2')
  })

  it('creates a new character with the reconcile decision applied', () => {
    const decisions = new Map<string, ReconcileDecision>([
      ['h1', { kind: 'create', flag: { partnerId: 'char_a', reason: 'in-scene' } }],
    ])
    const { planned, handleMap } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'A dragon.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
      }),
      { ...base, decisions },
    )
    expect(planned[0].action).toMatchObject({
      kind: 'createEntity',
      payload: {
        entry: {
          name: 'Eldrin',
          status: 'active',
          nameCollisionFlag: 1,
          nameCollisionPartnerId: 'char_a',
          nameCollisionReason: 'in-scene',
          embeddingStale: 1,
        },
      },
    })
    expect(handleMap.get('h1')).toBe(payloadOf<{ entry: { id: string } }>(planned[0]).entry.id)
    expect(planned[0].entryId).toBe('e1')
  })

  it('creates an unflagged character with no partner or reason', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'A dragon.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
      }),
      { ...base, decisions: new Map([['h1', { kind: 'create', flag: null }]]) },
    )
    expect(planned[0].action).toMatchObject({
      kind: 'createEntity',
      payload: {
        entry: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
      },
    })
  })

  it('promotes instead of creating when reconcile said promote', () => {
    const decisions = new Map<string, ReconcileDecision>([
      ['h1', { kind: 'promote', entityId: 'char_1', similarity: 0.9 }],
    ])
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'The keeper.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
      }),
      { ...base, decisions },
    )
    expect(planned).toHaveLength(1)
    expect(planned[0].action).toMatchObject({
      kind: 'promoteStagedEntity',
      payload: { id: 'char_1' },
    })
  })

  it('resolves a temp handle used later in the same reply to the allocated id', () => {
    const decisions = new Map<string, ReconcileDecision>([['h1', { kind: 'create', flag: null }]])
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'The keeper.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
      }),
      { ...base, decisions },
    )
    const created = planned.find((p) => p.action.kind === 'createEntity')
    const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
    expect(payloadOf<{ entry: { entityId: string } }>(involvement).entry.entityId).toBe(
      payloadOf<{ entry: { id: string } }>(created).entry.id,
    )
  })

  it('drops a fact whose ref cannot be resolved and counts it', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      reply({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'nope' }], awareness: [] },
        ],
      }),
      base,
    )
    expect(planned.filter((p) => p.action.kind === 'createHappeningInvolvement')).toHaveLength(0)
    expect(unresolvedRefs).toEqual(['nope'])
  })

  it('orders creates before the rows that reference them', () => {
    const decisions = new Map<string, ReconcileDecision>([['h1', { kind: 'create', flag: null }]])
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        newCharacters: [
          { handle: 'h1', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
        ],
      }),
      { ...base, decisions },
    )
    const kinds = planned.map((p) => p.action.kind)
    expect(kinds.indexOf('createEntity')).toBeLessThan(kinds.indexOf('createHappening'))
    expect(kinds.indexOf('createHappening')).toBeLessThan(
      kinds.indexOf('createHappeningInvolvement'),
    )
  })

  describe('story-time anchoring', () => {
    type HappeningEntry = { temporal: string | null; occurredAtEntryId: string | null }

    const plan = (happening: Record<string, unknown>) =>
      buildClassifierActions(
        reply({ happenings: [{ involvements: [], awareness: [], ...happening }] as never }),
        base,
      )

    it('keeps a free-form temporal when no occurredAtTurn is given', () => {
      const { planned } = plan({ title: 'A', sourceTurn: 't1', temporal: 'three winters ago' })
      expect(payloadOf<{ entry: HappeningEntry }>(planned[0]).entry).toMatchObject({
        temporal: 'three winters ago',
        occurredAtEntryId: null,
      })
    })

    it('resolves occurredAtTurn to an entry ref', () => {
      const { planned } = plan({ title: 'A', sourceTurn: 't1', occurredAtTurn: 't2' })
      expect(payloadOf<{ entry: HappeningEntry }>(planned[0]).entry).toMatchObject({
        temporal: null,
        occurredAtEntryId: 'e2',
      })
    })

    it('lets the entry ref win when both are present, satisfying the table CHECK', () => {
      const { planned } = plan({
        title: 'A',
        sourceTurn: 't1',
        temporal: 'three winters ago',
        occurredAtTurn: 't2',
      })
      expect(payloadOf<{ entry: HappeningEntry }>(planned[0]).entry).toMatchObject({
        temporal: null,
        occurredAtEntryId: 'e2',
      })
    })

    it('degrades a bogus occurredAtTurn to temporal instead of the window head', () => {
      const { planned, unresolvedRefs, fellBackCount } = plan({
        title: 'A',
        sourceTurn: 't1',
        temporal: 'three winters ago',
        occurredAtTurn: 't99',
      })
      expect(payloadOf<{ entry: HappeningEntry }>(planned[0]).entry).toMatchObject({
        temporal: 'three winters ago',
        occurredAtEntryId: null,
      })
      expect(unresolvedRefs).toEqual(['t99'])
      // The provenance anchor resolved cleanly: a story-time miss is not a
      // provenance fallback.
      expect(fellBackCount).toBe(0)
    })
  })

  describe('ref kind expectations', () => {
    const entities = [...(base.entities as never[]), nonCharacterRow('loc_1', 'location')]

    it('rejects a non-character awareness ref', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          happenings: [
            {
              title: 'A',
              sourceTurn: 't1',
              involvements: [],
              awareness: [{ ref: 'loc_1', source: 's', severity: 0.5 }],
            },
          ],
        }),
        { ...base, entities },
      )
      expect(planned.filter((p) => p.action.kind === 'upsertHappeningAwareness')).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['loc_1'])
    })

    it('rejects a relationship whose object is not a character', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          relationships: [{ subject: 'char_a', object: 'loc_1', kind: 'guards', sourceTurn: 't1' }],
        }),
        { ...base, entities },
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['loc_1'])
    })

    it('accepts a non-character involvement ref, which is polymorphic', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          happenings: [
            { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'loc_1' }], awareness: [] },
          ],
        }),
        { ...base, entities },
      )
      const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
      expect(payloadOf<{ entry: { entityId: string } }>(involvement).entry.entityId).toBe('loc_1')
      expect(unresolvedRefs).toEqual([])
    })
  })

  describe('reconcile decisions', () => {
    it('records a newCharacters handle that has no decision and plans nothing', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          newCharacters: [
            { handle: 'h9', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
        }),
        base,
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['h9'])
    })

    it('drops a blank-named character even when reconcile decided create', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          newCharacters: [
            { handle: 'h1', name: '  ', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
        }),
        { ...base, decisions: new Map([['h1', { kind: 'create', flag: null }]]) },
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['h1'])
    })

    it('emits nothing for a known decision but still resolves the handle', () => {
      const decisions = new Map<string, ReconcileDecision>([
        ['h1', { kind: 'known', entityId: 'char_a', similarity: 0.9 }],
      ])
      const { planned, handleMap } = buildClassifierActions(
        reply({
          newCharacters: [
            { handle: 'h1', name: 'char_a', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
        }),
        { ...base, decisions },
      )
      expect(planned).toHaveLength(0)
      expect(handleMap.get('h1')).toBe('char_a')
    })

    // Rebinding the handle would retarget every ref emitted before the duplicate,
    // including ones the model wrote for the first character.
    it('keeps the first binding when a handle is reused, and reports the collision', () => {
      const decisions = new Map<string, ReconcileDecision>([['h1', { kind: 'create', flag: null }]])
      const { planned, handleMap, unresolvedRefs } = buildClassifierActions(
        reply({
          newCharacters: [
            { handle: 'h1', name: 'First', description: 'x', keywords: [], sourceTurn: 't1' },
            { handle: 'h1', name: 'Second', description: 'y', keywords: [], sourceTurn: 't1' },
          ],
        }),
        { ...base, decisions },
      )
      const creates = planned.filter((p) => p.action.kind === 'createEntity')
      expect(creates).toHaveLength(1)
      expect(
        (creates[0].action as { payload: { entry: { name: string; id: string } } }).payload.entry
          .name,
      ).toBe('First')
      expect(handleMap.get('h1')).toBe(
        (creates[0].action as { payload: { entry: { id: string } } }).payload.entry.id,
      )
      expect(unresolvedRefs).toEqual(['h1'])
    })
  })

  it('skips a self-relationship', () => {
    const { planned } = buildClassifierActions(
      reply({
        relationships: [{ subject: 'char_a', object: 'char_a', kind: 'rival', sourceTurn: 't1' }],
      }),
      base,
    )
    expect(planned).toHaveLength(0)
  })

  describe('status-flip monotonicity', () => {
    const flip = (ref: string, to: string, entities: never[]) =>
      buildClassifierActions(reply({ statusFlips: [{ ref, to, sourceTurn: 't1' }] as never }), {
        ...base,
        entities,
      })

    it('promotes a staged entity to active', () => {
      const { planned } = flip('char_s', 'active', [entityRow('char_s', 'staged')])
      expect(planned[0].action).toMatchObject({
        kind: 'promoteStagedEntity',
        payload: { id: 'char_s' },
      })
    })

    it('skips an active entity flipped to active', () => {
      const { planned } = flip('char_a', 'active', [entityRow('char_a')])
      expect(planned).toHaveLength(0)
    })

    // classifier.md → What the classifier writes → Status transitions: a return in the scene now.
    it('returns a retired character to active', () => {
      const { planned } = flip('char_r', 'active', [entityRow('char_r', 'retired')])
      expect(planned).toEqual([
        {
          action: {
            kind: 'returnFromRetirement',
            source: 'periodic_classifier',
            payload: { branchId: 'branch_1', id: 'char_r', proseEntryId: 'e1' },
          },
          entryId: 'e1',
        },
      ])
    })

    // classifier.md → What the classifier writes → Status transitions: the latest prose wins.
    it.each([
      ['an active', 'active', [['retireEntity', 'e3']]],
      [
        'a retired',
        'retired',
        [
          ['returnFromRetirement', 'e1'],
          ['retireEntity', 'e3'],
        ],
      ],
      [
        'a staged',
        'staged',
        [
          ['promoteStagedEntity', 'e1'],
          ['retireEntity', 'e3'],
        ],
      ],
    ])("applies %s character's flips in source-turn order", (_label, status, expected) => {
      const { planned } = buildClassifierActions(
        reply({
          statusFlips: [
            { ref: 'char_x', to: 'retired', sourceTurn: 't3' },
            { ref: 'char_x', to: 'active', sourceTurn: 't1' },
          ],
        }),
        { ...base, entities: [entityRow('char_x', status)] },
      )
      expect(planned.map((p) => [p.action.kind, p.entryId])).toEqual(expected)
    })

    // A place, a faction or an item comes back only by the user.
    it.each(['faction', 'location', 'item'])(
      'never returns a retired %s, and reports its ref',
      (kind) => {
        const row = { ...(nonCharacterRow('x_r', kind) as object), status: 'retired' } as never
        const { planned, unresolvedRefs } = flip('x_r', 'active', [row])
        expect(planned).toEqual([])
        expect(unresolvedRefs).toEqual(['x_r'])
      },
    )

    // classifier.md → What the classifier writes: never a location; only the user retires a place.
    it('never retires a location', () => {
      const { planned } = flip('loc_inn', 'retired', [nonCharacterRow('loc_inn', 'location')])
      expect(planned).toHaveLength(0)
    })

    it('still retires a faction', () => {
      const { planned } = flip('fac_guild', 'retired', [nonCharacterRow('fac_guild', 'faction')])
      expect(planned.map((p) => p.action.kind)).toEqual(['retireEntity'])
    })

    it('skips a retire flip when the snapshot status is staged, not active', () => {
      const { planned } = flip('char_s', 'retired', [entityRow('char_s', 'staged')])
      expect(planned).toHaveLength(0)
    })

    it('emits one delta for two identical retire flips', () => {
      const { planned } = buildClassifierActions(
        reply({
          statusFlips: [
            { ref: 'char_a', to: 'retired', sourceTurn: 't1' },
            { ref: 'char_a', to: 'retired', sourceTurn: 't2' },
          ],
        }),
        { ...base, entities: [entityRow('char_a')] },
      )
      expect(planned).toHaveLength(1)
    })

    it('retires an entity promoted earlier in the same reply', () => {
      const decisions = new Map<string, ReconcileDecision>([
        ['h1', { kind: 'promote', entityId: 'char_s', similarity: 0.9 }],
      ])
      const { planned } = buildClassifierActions(
        reply({
          statusFlips: [{ ref: 'char_s', to: 'retired', reason: 'fell', sourceTurn: 't2' }],
          newCharacters: [
            { handle: 'h1', name: 'char_s', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
        }),
        { ...base, decisions, entities: [entityRow('char_s', 'staged')] },
      )
      expect(planned.map((p) => p.action.kind)).toEqual(['promoteStagedEntity', 'retireEntity'])
      expect(planned[1].action).toMatchObject({
        payload: { id: 'char_s', retiredReason: 'fell' },
      })
    })

    it('retires a character created earlier in the same reply', () => {
      const decisions = new Map<string, ReconcileDecision>([['h1', { kind: 'create', flag: null }]])
      const { planned } = buildClassifierActions(
        reply({
          statusFlips: [{ ref: 'h1', to: 'retired', reason: 'fell', sourceTurn: 't2' }],
          newCharacters: [
            { handle: 'h1', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
        }),
        { ...base, decisions },
      )
      const createdId = payloadOf<{ entry: { id: string } }>(planned[0]).entry.id
      expect(planned[1].action).toMatchObject({
        kind: 'retireEntity',
        payload: { id: createdId },
      })
    })
  })
})

describe('entity keywords', () => {
  const candidate = (keywords: string[]) =>
    reply({
      newCharacters: [{ handle: 'new:k', name: 'Kael', description: 'A courier.', keywords }],
    })

  const decide = (decision: ReconcileDecision) => new Map([['new:k', decision]])

  // classifier.md → Entity keywords.
  it('seeds keywords on a created character', () => {
    const { planned } = buildClassifierActions(candidate(['the grey wolf']), {
      ...base,
      decisions: decide({ kind: 'create', flag: null }),
    })
    expect(payloadOf<{ entry: { keywords: string[] } }>(planned[0]).entry.keywords).toEqual([
      'the grey wolf',
    ])
  })

  // The handler merges the sent terms into the live list, so a term the user added survives.
  it('sends a known entity only the terms its snapshot lacks', () => {
    const { planned } = buildClassifierActions(candidate(['the grey wolf', 'The Innkeeper']), {
      ...base,
      entities: [entityRow('char_kael', 'active', 'Kael', ['the innkeeper'])] as never[],
      decisions: decide({ kind: 'known', entityId: 'char_kael', similarity: 0.9 }),
    })
    expect(planned).toHaveLength(1)
    expect(planned[0].action).toMatchObject({
      kind: 'appendEntityKeywords',
      payload: { id: 'char_kael', keywords: ['the grey wolf'] },
    })
  })

  it('sends a promoted entity only the terms its snapshot lacks', () => {
    const { planned } = buildClassifierActions(candidate(['the grey wolf', 'The Innkeeper']), {
      ...base,
      entities: [entityRow('char_kael', 'staged', 'Kael', ['the innkeeper'])] as never[],
      decisions: decide({ kind: 'promote', entityId: 'char_kael', similarity: 0.9 }),
    })
    expect(planned.map((p) => p.action.kind)).toEqual([
      'promoteStagedEntity',
      'appendEntityKeywords',
    ])
    expect(payloadOf<{ keywords: string[] }>(planned[1]).keywords).toEqual(['the grey wolf'])
  })

  it('trims the terms it sends', () => {
    const { planned } = buildClassifierActions(candidate(['  the grey wolf ']), {
      ...base,
      entities: [entityRow('char_kael', 'active', 'Kael')] as never[],
      decisions: decide({ kind: 'known', entityId: 'char_kael', similarity: 0.9 }),
    })
    expect(payloadOf<{ keywords: string[] }>(planned[0]).keywords).toEqual(['the grey wolf'])
  })

  // Dedupe runs under matchTerms' normalization, so a case variant is not a second
  // entry — and a pass that adds nothing must cost no delta row.
  it('plans no write when every keyword is already held, case aside', () => {
    const { planned } = buildClassifierActions(candidate(['the grey wolf']), {
      ...base,
      entities: [entityRow('char_kael', 'active', 'Kael', ['The Grey Wolf'])] as never[],
      decisions: decide({ kind: 'known', entityId: 'char_kael', similarity: 0.9 }),
    })
    expect(planned).toEqual([])
  })

  // The keyword index updates on each append, not only from the pass's opening snapshot.
  it("filters a second candidate against the first candidate's keywords in the same reply", () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:k1',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['the grey wolf'],
          },
          {
            handle: 'new:k2',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['The Grey Wolf', 'the innkeeper'],
          },
        ],
      }),
      {
        ...base,
        entities: [entityRow('char_kael', 'active', 'Kael')] as never[],
        decisions: new Map<string, ReconcileDecision>([
          ['new:k1', { kind: 'known', entityId: 'char_kael', similarity: 0.9 }],
          ['new:k2', { kind: 'known', entityId: 'char_kael', similarity: 0.9 }],
        ]),
      },
    )
    const appends = planned.filter((p) => p.action.kind === 'appendEntityKeywords')
    expect(appends).toHaveLength(2)
    expect(payloadOf<{ keywords: string[] }>(appends[1]).keywords).toEqual(['the innkeeper'])
  })

  // Reconciliation decides every namesake against the same snapshot status (reconcile.ts):
  // two candidates for one staged entity always agree — never split 'promote' vs 'known'.
  it('plans a repeated promote for a staged entity reconciliation decides promote twice, filtering the second append against the first', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:k1',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['the grey wolf'],
          },
          {
            handle: 'new:k2',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['the grey wolf', 'the innkeeper'],
          },
        ],
      }),
      {
        ...base,
        entities: [entityRow('char_kael', 'staged', 'Kael')] as never[],
        decisions: new Map<string, ReconcileDecision>([
          ['new:k1', { kind: 'promote', entityId: 'char_kael', similarity: 0.9 }],
          ['new:k2', { kind: 'promote', entityId: 'char_kael', similarity: 0.9 }],
        ]),
      },
    )
    // A mention's terms plan with the row's other keyword writes, after the creates.
    expect(planned.map((p) => p.action.kind)).toEqual([
      'promoteStagedEntity',
      'promoteStagedEntity',
      'appendEntityKeywords',
      'appendEntityKeywords',
    ])
    expect(payloadOf<{ keywords: string[] }>(planned[3]).keywords).toEqual(['the innkeeper'])
  })

  // Two guarded writes: a promotion the user pre-empted no-ops while the aliases still land.
  it('promotes and appends keywords as separate writes', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:k',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['the grey wolf'],
            sourceTurn: 't1',
          },
        ],
      }),
      {
        ...base,
        entities: [entityRow('char_kael', 'staged', 'Kael')] as never[],
        decisions: decide({ kind: 'promote', entityId: 'char_kael', similarity: 0.9 }),
      },
    )
    expect(planned.map((p) => p.action.kind)).toEqual([
      'promoteStagedEntity',
      'appendEntityKeywords',
    ])
    expect(planned.map((p) => p.entryId)).toEqual(['e1', 'e1'])
    expect(payloadOf<{ id: string }>(planned[0]).id).toBe('char_kael')
    expect(payloadOf<{ id: string; keywords: string[] }>(planned[1])).toMatchObject({
      id: 'char_kael',
      keywords: ['the grey wolf'],
    })
  })
})

// classifier.md → What the classifier writes → Entity keywords: later passes append
// through the alias list, append-and-deduplicate, never remove.
describe('alias list', () => {
  const aliasReply = (
    aliases: ClassifierExtraction['aliases'],
    newCharacters: ClassifierExtraction['newCharacters'] = [],
  ): ClassifierExtraction => reply({ newCharacters, aliases })
  const kael = entityRow('char_kael', 'active', 'Kael', ['the courier'])
  const appendOf = (
    id: string,
    keywords: string[],
    proseEntryId: string,
    entryId = proseEntryId,
  ) => ({
    action: {
      kind: 'appendEntityKeywords',
      source: 'periodic_classifier',
      payload: { branchId: 'branch_1', id, keywords, proseEntryId },
    },
    entryId,
  })

  it('appends to a listed character only the terms its line lacks', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      aliasReply([{ ref: 'char_kael', terms: ['the Grey Wolf', 'The Courier'], sourceTurn: 't2' }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([appendOf('char_kael', ['the Grey Wolf'], 'e2')])
    expect(unresolvedRefs).toEqual([])
  })

  it('appends to a listed entity of any kind', () => {
    const ford = nonCharacterRow('loc_ford', 'location')
    const { planned } = buildClassifierActions(
      aliasReply([{ ref: 'loc_ford', terms: ['the crossing'], sourceTurn: 't1' }]),
      { ...base, entities: [ford] },
    )
    expect(planned).toEqual([appendOf('loc_ford', ['the crossing'], 'e1')])
  })

  // canon: the ref names a listed entity. A handle's row is this reply's create.
  it('reports a newCharacters handle as unresolved and writes nothing for it', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      aliasReply(
        [{ ref: 'new:j', terms: ['the ferryman'], sourceTurn: 't1' }],
        [{ handle: 'new:j', name: 'Jorin', description: 'x', keywords: [], sourceTurn: 't1' }],
      ),
      { ...base, decisions: new Map([['new:j', { kind: 'create', flag: null }]]) },
    )
    expect(planned.map((p) => p.action.kind)).toEqual(['createEntity'])
    expect(unresolvedRefs).toEqual(['new:j'])
  })

  // canon: the ref names a listed entity, so a handle reconciliation absorbed into one is no ref.
  it('reports a handle absorbed into a listed row as unresolved, and appends nothing for it', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      aliasReply(
        [{ ref: 'new:k', terms: ['the rider'], sourceTurn: 't2' }],
        [
          {
            handle: 'new:k',
            name: 'Kael',
            description: 'x',
            keywords: ['the Grey Wolf'],
            sourceTurn: 't1',
          },
        ],
      ),
      {
        ...base,
        entities: [kael],
        decisions: new Map([['new:k', { kind: 'known', entityId: 'char_kael', similarity: 0.9 }]]),
      },
    )
    expect(planned).toEqual([appendOf('char_kael', ['the Grey Wolf'], 'e1')])
    expect(unresolvedRefs).toEqual(['new:k'])
  })

  it('reports an unknown ref as unresolved', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      aliasReply([{ ref: 'c9', terms: ['the ferryman'], sourceTurn: 't1' }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([])
    expect(unresolvedRefs).toEqual(['c9'])
  })

  // No write means no anchor: an unattributed entry that adds nothing counts no fallback.
  it('plans nothing, and resolves no anchor, when every term is held or blank', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      aliasReply([{ ref: 'char_kael', terms: ['THE COURIER ', '  '] }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([])
    expect(fellBackCount).toBe(0)
  })

  it('dates an unattributed alias by the oldest turn and anchors it at the head', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      aliasReply([{ ref: 'char_kael', terms: ['the rider'] }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([appendOf('char_kael', ['the rider'], 'e1', 'e3')])
    expect(fellBackCount).toBe(1)
  })

  it('de-duplicates two entries for one entity against each other', () => {
    const { planned } = buildClassifierActions(
      aliasReply([
        { ref: 'char_kael', terms: ['the Grey Wolf'], sourceTurn: 't1' },
        {
          ref: 'char_kael',
          terms: ['the grey wolf', 'The Courier', 'the rider'],
          sourceTurn: 't3',
        },
      ]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([
      appendOf('char_kael', ['the Grey Wolf'], 'e1'),
      appendOf('char_kael', ['the rider'], 'e3'),
    ])
  })

  it('de-duplicates against keywords an absorb in the same reply appended', () => {
    const { planned } = buildClassifierActions(
      aliasReply(
        [{ ref: 'char_kael', terms: ['the grey wolf', 'the rider'], sourceTurn: 't2' }],
        [
          {
            handle: 'new:k',
            name: 'Kael',
            description: 'x',
            keywords: ['the Grey Wolf'],
            sourceTurn: 't1',
          },
        ],
      ),
      {
        ...base,
        entities: [kael],
        decisions: new Map([['new:k', { kind: 'known', entityId: 'char_kael', similarity: 0.9 }]]),
      },
    )
    expect(planned).toEqual([
      appendOf('char_kael', ['the Grey Wolf'], 'e1'),
      appendOf('char_kael', ['the rider'], 'e2'),
    ])
  })
})

// cadence.md → User edits and classifier writes.
describe('prose source on guarded writes', () => {
  it("stamps each guarded write with its own fact's anchor as proseEntryId", () => {
    const { planned } = buildClassifierActions(
      reply({
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: 'sister', sourceTurn: 't3' },
        ],
        statusFlips: [
          { ref: 'char_s', to: 'active', sourceTurn: 't2' },
          { ref: 'char_a', to: 'retired', sourceTurn: 't1' },
        ],
        newCharacters: [
          { handle: 'h1', name: 'P', description: 'x', keywords: ['the keeper'], sourceTurn: 't1' },
          { handle: 'h2', name: 'A', description: 'x', keywords: ['the wolf'], sourceTurn: 't2' },
        ],
      }),
      {
        ...base,
        entities: [
          entityRow('char_p', 'staged'),
          entityRow('char_s', 'staged'),
          entityRow('char_a'),
          entityRow('char_kael'),
          entityRow('char_aria'),
        ] as never[],
        decisions: new Map<string, ReconcileDecision>([
          ['h1', { kind: 'promote', entityId: 'char_p', similarity: 0.9 }],
          ['h2', { kind: 'known', entityId: 'char_a', similarity: 0.95 }],
        ]),
      },
    )
    expect(
      planned.map((p) => [
        p.action.kind,
        payloadOf<{ proseEntryId?: string }>(p).proseEntryId,
        p.entryId,
      ]),
    ).toEqual([
      ['promoteStagedEntity', 'e1', 'e1'],
      ['appendEntityKeywords', 'e1', 'e1'],
      ['appendEntityKeywords', 'e2', 'e2'],
      ['upsertCharacterRelationship', 'e3', 'e3'],
      ['retireEntity', 'e1', 'e1'],
      ['promoteStagedEntity', 'e2', 'e2'],
    ])
  })

  // The survival anchor falls back to the newest turn; precedence must not date the
  // prose that late, or a user edit made after its real source would lose.
  it('dates an unattributed fact by the oldest window turn, keeping the head as its anchor', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      reply({
        relationships: [{ subject: 'char_kael', object: 'char_aria', kind: 'sister' }],
        statusFlips: [{ ref: 'char_a', to: 'retired' }],
        newCharacters: [{ handle: 'h1', name: 'P', description: 'x', keywords: ['the keeper'] }],
      }),
      {
        ...base,
        entities: [
          entityRow('char_p', 'staged'),
          entityRow('char_a'),
          entityRow('char_kael'),
          entityRow('char_aria'),
        ] as never[],
        decisions: new Map<string, ReconcileDecision>([
          ['h1', { kind: 'promote', entityId: 'char_p', similarity: 0.9 }],
        ]),
      },
    )
    expect(
      planned.map((p) => [
        p.action.kind,
        payloadOf<{ proseEntryId?: string }>(p).proseEntryId,
        p.entryId,
      ]),
    ).toEqual([
      ['promoteStagedEntity', 'e1', 'e3'],
      ['appendEntityKeywords', 'e1', 'e3'],
      ['upsertCharacterRelationship', 'e1', 'e3'],
      ['retireEntity', 'e1', 'e3'],
    ])
    expect(fellBackCount).toBe(3)
  })
})

// The classifier is the only machine writer into an embedded column and the embedder
// drops anything past its window silently, so bounding has to happen in the planner.
describe('embedded-column bounds', () => {
  const character = (name: string, description: string) =>
    reply({ newCharacters: [{ handle: 'h1', name, description, keywords: [], sourceTurn: 't1' }] })
  const deps = {
    ...base,
    decisions: new Map([['h1', { kind: 'create', flag: null }]]),
  } as never
  const entryOf = (planned: PlannedWrite[]) =>
    payloadOf<{ entry: { name: string; description: string } }>(planned[0]).entry

  it('cuts an over-long character name at 120 characters', () => {
    const { planned } = buildClassifierActions(
      character('N'.repeat(119) + 'X' + 'Y'.repeat(80), 'A dragon.'),
      deps,
    )
    expect(entryOf(planned as PlannedWrite[]).name).toBe('N'.repeat(119) + 'X')
  })

  // A cut landing between the halves of an astral character would store a lone
  // surrogate, which renders as a replacement character wherever the name is shown.
  it('backs off a cut that would split a surrogate pair', () => {
    const name = 'A'.repeat(119) + '\u{1F409}' + 'B'.repeat(40)
    expect(clampEmbeddedCharacter({ name, description: '' }).name).toBe('A'.repeat(119))
  })

  it('keeps an astral character the cut clears whole', () => {
    const name = 'A'.repeat(118) + '\u{1F409}' + 'B'.repeat(40)
    expect(clampEmbeddedCharacter({ name, description: '' }).name).toBe(
      'A'.repeat(118) + '\u{1F409}',
    )
  })

  it('cuts an over-long character description at 1200 characters', () => {
    const { planned } = buildClassifierActions(
      character('Eldrin', 'D'.repeat(1199) + 'X' + 'Z'.repeat(500)),
      deps,
    )
    expect(entryOf(planned as PlannedWrite[]).description).toBe('D'.repeat(1199) + 'X')
  })

  it('leaves a name and description already inside the bounds untouched', () => {
    const { planned } = buildClassifierActions(character('Eldrin', 'A dragon.'), deps)
    expect(entryOf(planned as PlannedWrite[])).toMatchObject({
      name: 'Eldrin',
      description: 'A dragon.',
    })
  })

  // slice() alone would leave the cut sitting on whitespace, which renders as a
  // trailing space everywhere the name is shown.
  it('trims the whitespace around a character name', () => {
    const { planned } = buildClassifierActions(character(' Eldrin\n', 'A dragon.'), deps)
    expect(entryOf(planned as PlannedWrite[]).name).toBe('Eldrin')
  })

  it('drops whitespace the cut lands on', () => {
    const { planned } = buildClassifierActions(
      character('A'.repeat(119) + ' ' + 'B'.repeat(80), 'A dragon.'),
      deps,
    )
    expect(entryOf(planned as PlannedWrite[]).name).toBe('A'.repeat(119))
  })

  it('bounds a happening title and description', () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'T'.repeat(119) + 'X' + 'Y'.repeat(80),
            description: 'D'.repeat(1199) + 'X' + 'Z'.repeat(500),
            sourceTurn: 't1',
            involvements: [],
            awareness: [],
          },
        ],
      }),
      base,
    )
    const entry = payloadOf<{ entry: { title: string; description: string } }>(planned[0]).entry
    expect(entry.title).toBe('T'.repeat(119) + 'X')
    expect(entry.description).toBe('D'.repeat(1199) + 'X')
  })

  // The clamp reads `description == null`, so an absent one must stay absent
  // rather than becoming the empty string the column has no meaning for.
  it('keeps an absent happening description null', () => {
    const { planned } = buildClassifierActions(
      reply({ happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }] }),
      base,
    )
    expect(payloadOf<{ entry: { description: null } }>(planned[0]).entry.description).toBeNull()
  })
})

// classifier.md → Mentioned places.
describe('mentioned places', () => {
  const placeRow = (
    id: string,
    name: string,
    parent: string | null,
    over: Partial<Entity> = {},
  ): Entity =>
    ({
      id,
      branchId: 'branch_1',
      kind: 'location',
      name,
      description: `${name}, as stored.`,
      status: 'active',
      keywords: [],
      state: { parent_location_id: parent },
      createdAt: 1,
      ...over,
    }) as unknown as Entity

  const newPlace = (handle: string, name: string, over: Partial<NewPlace> = {}): NewPlace => ({
    handle,
    name,
    description: `${name}, from the prose.`,
    keywords: [],
    sourceTurn: 't2',
    ...over,
  })

  const placesReply = (
    newPlaces: NewPlace[],
    over: Partial<ClassifierPlacesExtraction> = {},
  ): ClassifierPlacesExtraction => reply({ newPlaces, ...over })

  const deps = (entities: Entity[], over: Partial<typeof base> = {}) => {
    let n = 0
    return {
      ...base,
      entities: entities as never[],
      newId: (kind: string) => `${kind}_new${++n}`,
      ...over,
    }
  }

  type Created = {
    id: string
    name: string
    state: { parent_location_id: string | null; unplaced?: true }
  } & Record<string, unknown>
  const createdPlaces = (planned: readonly PlannedWrite[]) =>
    planned
      .filter((p) => p.action.kind === 'createEntity')
      .map((p) => payloadOf<{ entry: Created }>(p).entry)
      .filter((e) => e.kind === 'location')
  const parentOf = (planned: readonly PlannedWrite[], name: string) =>
    createdPlaces(planned).find((e) => e.name === name)?.state.parent_location_id
  const stateOf = (planned: readonly PlannedWrite[], name: string) =>
    createdPlaces(planned).find((e) => e.name === name)?.state
  const placementsOf = (planned: readonly PlannedWrite[]) =>
    planned.filter((p) => p.action.kind === 'placeLocation')
  // data-model.md → LocationState shape: known to exist, not where.
  const unplacedRow = (id: string, name: string, over: Partial<Entity> = {}) =>
    placeRow(id, name, null, { state: { parent_location_id: null, unplaced: true }, ...over })

  const TOWN = placeRow('loc_town', 'Varn', null)

  it('creates an active, auto place from the prose, stale, anchored on its turn', () => {
    const { planned, handleMap, parentDrops } = buildClassifierActions(
      placesReply([
        newPlace('new:mill', 'the Old Mill', {
          description: '  A mill on the ridge.  ',
          keywords: ['the mill', 'The Mill', ' '],
          parent: 'loc_town',
        }),
      ]),
      deps([TOWN]),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'createEntity',
          source: 'periodic_classifier',
          payload: {
            entry: {
              id: 'loc_new1',
              branchId: 'branch_1',
              kind: 'location',
              name: 'the Old Mill',
              description: 'A mill on the ridge.',
              keywords: ['the mill'],
              status: 'active',
              injectionMode: 'auto',
              state: { parent_location_id: 'loc_town' },
              nameCollisionFlag: 0,
              nameCollisionPartnerId: null,
              nameCollisionReason: null,
              embeddingStale: 1,
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
            },
          },
        },
        entryId: 'e2',
      },
    ])
    expect(handleMap.get('new:mill')).toBe('loc_new1')
    expect(parentDrops).toEqual([])
  })

  it('clamps the text as a new character is, and stores a blank description as null', () => {
    const long = 'x'.repeat(2000)
    const { planned } = buildClassifierActions(
      placesReply([
        newPlace('new:a', 'Ash', { description: long }),
        newPlace('new:b', 'Birch', { description: '   ' }),
      ]),
      deps([]),
    )
    const [ash, birch] = createdPlaces(planned)
    expect(ash.description).toBe(
      clampEmbeddedCharacter({ name: 'Ash', description: long }).description,
    )
    expect(birch.description).toBeNull()
  })

  it('leaves a place whose parent the turns do not give unplaced, unlogged', () => {
    const { planned, parentDrops } = buildClassifierActions(
      placesReply([newPlace('new:a', 'Ash')]),
      deps([]),
    )
    expect(stateOf(planned, 'Ash')).toEqual({ parent_location_id: null, unplaced: true })
    expect(parentDrops).toEqual([])
  })

  // classifier.md → What the classifier writes → First profiles. piggyback.md → Trailing block
  // format: a long value is cut back to a clause boundary.
  it("cuts a new place's long condition at a clause", () => {
    const { planned } = buildClassifierActions(
      placesReply([
        newPlace('new:a', 'Ash', {
          parent: 'top-level',
          condition: `${'a'.repeat(300)}, ${'b'.repeat(300)}`,
        }),
      ]),
      deps([]),
    )
    expect(stateOf(planned, 'Ash')).toEqual({
      parent_location_id: null,
      condition: 'a'.repeat(300),
    })
  })

  it("writes a new place's condition into its state, trimmed and bounded", () => {
    const { planned } = buildClassifierActions(
      placesReply([
        newPlace('new:a', 'Ash', { parent: 'top-level', condition: '  burned to the waterline ' }),
        newPlace('new:b', 'Birch', { condition: `${'c'.repeat(499)}😀tail` }),
      ]),
      deps([]),
    )
    expect(stateOf(planned, 'Ash')).toEqual({
      parent_location_id: null,
      condition: 'burned to the waterline',
    })
    expect(stateOf(planned, 'Birch')).toEqual({
      parent_location_id: null,
      unplaced: true,
      condition: 'c'.repeat(499),
    })
  })

  it('drops the condition of a place it reuses', () => {
    const { planned } = buildClassifierActions(
      placesReply([newPlace('new:v', 'Varn', { parent: 'top-level', condition: 'flooded' })]),
      deps([TOWN]),
    )
    expect(planned).toEqual([])
  })

  // classifier.md → Mentioned places → Parent: the schema's explicit top-level choice.
  it.each(['top-level', ' Top-Level '])(
    'puts a place whose parent is %j at the top level, unlogged',
    (parent) => {
      const { planned, parentDrops } = buildClassifierActions(
        placesReply([newPlace('new:a', 'Ash', { parent })]),
        deps([]),
      )
      expect(stateOf(planned, 'Ash')).toEqual({ parent_location_id: null })
      expect(parentDrops).toEqual([])
    },
  )

  it('resolves parents top-down: a child listed before its parent hangs under its new row', () => {
    const { planned } = buildClassifierActions(
      placesReply([
        newPlace('new:cellar', 'the Cellar', { parent: 'new:inn' }),
        newPlace('new:inn', 'the Gull Inn', { parent: 'loc_town' }),
      ]),
      deps([TOWN]),
    )
    expect(createdPlaces(planned).map((e) => e.name)).toEqual(['the Gull Inn', 'the Cellar'])
    expect(parentOf(planned, 'the Gull Inn')).toBe('loc_town')
    expect(parentOf(planned, 'the Cellar')).toBe('loc_new1')
  })

  it.each([
    ['names nothing', 'loc_missing', [TOWN], 'unresolved'],
    ['is a character', 'char_kael', [TOWN, entityRow('char_kael')], 'unresolved'],
    [
      'is retired',
      'loc_ruin',
      [placeRow('loc_ruin', 'Ruin', null, { status: 'retired' })],
      'retired',
    ],
    [
      'has a broken chain above it',
      'loc_a',
      [placeRow('loc_a', 'Upper', 'loc_b'), placeRow('loc_b', 'Lower', 'loc_a')],
      'chain-broken',
    ],
  ] as const)(
    'leaves a place whose parent %s unplaced, and reports why',
    (_label, parent, entities, cause) => {
      const { planned, parentDrops } = buildClassifierActions(
        placesReply([newPlace('new:inn', 'the Gull Inn', { parent })]),
        deps([...entities]),
      )
      expect(stateOf(planned, 'the Gull Inn')).toEqual({ parent_location_id: null, unplaced: true })
      expect(parentDrops).toEqual([{ handle: 'new:inn', parent, cause }])
    },
  )

  it('hangs a child under a new place whose own parent was dropped', () => {
    const { planned, parentDrops } = buildClassifierActions(
      placesReply([
        newPlace('new:inn', 'the Gull Inn', { parent: 'loc_missing' }),
        newPlace('new:cellar', 'the Cellar', { parent: 'new:inn' }),
      ]),
      deps([]),
    )
    expect(parentOf(planned, 'the Cellar')).toBe('loc_new1')
    expect(parentDrops.map((d) => d.handle)).toEqual(['new:inn'])
  })

  describe('reuse', () => {
    const MILL = placeRow('loc_mill', 'The Old Mill', 'loc_town', {
      keywords: ['the mill'],
      status: 'staged',
    })

    it('reuses an exact sibling, keeping its description and status, appending only new terms', () => {
      const { planned, handleMap } = buildClassifierActions(
        placesReply([
          newPlace('new:mill', 'the old mill', {
            parent: 'loc_town',
            keywords: ['The Mill', 'the grinding house'],
            sourceTurn: 't3',
          }),
        ]),
        deps([TOWN, MILL]),
      )
      expect(handleMap.get('new:mill')).toBe('loc_mill')
      // No create, no description write and no promotion: a mention doesn't enter a staged place.
      expect(planned).toEqual([
        {
          action: {
            kind: 'appendEntityKeywords',
            source: 'periodic_classifier',
            payload: {
              branchId: 'branch_1',
              id: 'loc_mill',
              keywords: ['the grinding house'],
              proseEntryId: 'e3',
            },
          },
          entryId: 'e3',
        },
      ])
    })

    it('writes nothing for a reused sibling whose terms it already holds', () => {
      const { planned } = buildClassifierActions(
        placesReply([
          newPlace('new:mill', 'The Old Mill', { parent: 'loc_town', keywords: ['the mill'] }),
        ]),
        deps([TOWN, MILL]),
      )
      expect(planned).toEqual([])
    })

    it('hangs a child under the row its parent reused, and names it in an involvement', () => {
      const { planned } = buildClassifierActions(
        placesReply(
          [
            newPlace('new:mill', 'The Old Mill', { parent: 'loc_town' }),
            newPlace('new:wheel', 'the Wheelhouse', { parent: 'new:mill' }),
          ],
          {
            happenings: [
              {
                title: 'The wheel jams',
                sourceTurn: 't2',
                involvements: [{ ref: 'new:mill', role: 'site' }],
                awareness: [],
              },
            ],
          },
        ),
        deps([TOWN, MILL]),
      )
      expect(parentOf(planned, 'the Wheelhouse')).toBe('loc_mill')
      const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
      expect(payloadOf<{ entry: { entityId: string } }>(involvement).entry.entityId).toBe(
        'loc_mill',
      )
    })

    // The pass saw every place, so a place a disabled one hides is not under the town.
    it('never reaches a place through a disabled one, as the narrator map would', () => {
      const vault = placeRow('loc_vault', 'The Vault', 'loc_town', { injectionMode: 'disabled' })
      const cellar = placeRow('loc_cellar', 'the Cellar', 'loc_vault')
      const { planned, handleMap } = buildClassifierActions(
        placesReply([newPlace('new:cellar', 'the Cellar', { parent: 'loc_town' })]),
        deps([TOWN, vault, cellar]),
      )
      expect(handleMap.get('new:cellar')).toBe('loc_new1')
      expect(parentOf(planned, 'the Cellar')).toBe('loc_town')
    })

    it('compares a top-level candidate only with the top-level places', () => {
      const { planned } = buildClassifierActions(
        placesReply([newPlace('new:mill', 'The Old Mill', { parent: 'top-level' })]),
        deps([TOWN, MILL]),
      )
      expect(createdPlaces(planned)).toEqual([
        expect.objectContaining({
          name: 'The Old Mill',
          state: { parent_location_id: null },
          nameCollisionFlag: 0,
        }),
      ])
    })

    it('reuses the one exact namesake anywhere for a place the turns do not place, placing nothing', () => {
      const { planned, handleMap } = buildClassifierActions(
        placesReply([newPlace('new:mill', 'the old mill')]),
        deps([TOWN, MILL]),
      )
      expect(handleMap.get('new:mill')).toBe('loc_mill')
      expect(planned).toEqual([])
    })

    // classifier.md → Mentioned places → Matching: a reused unplaced place takes the entry's parent.
    const VARN = unplacedRow('loc_varn', 'Varn')
    const REACH = placeRow('loc_reach', 'the Eastern Reach', null)

    it('places a reused unplaced place under the parent the entry gives, anchored on its turn', () => {
      const { planned, handleMap } = buildClassifierActions(
        placesReply([newPlace('new:varn', 'Varn', { parent: 'loc_reach', sourceTurn: 't3' })]),
        deps([REACH, VARN]),
      )
      expect(handleMap.get('new:varn')).toBe('loc_varn')
      expect(planned).toEqual([
        {
          action: {
            kind: 'placeLocation',
            source: 'periodic_classifier',
            payload: {
              branchId: 'branch_1',
              id: 'loc_varn',
              placement: { kind: 'under', parentId: 'loc_reach' },
              proseEntryId: 'e3',
            },
          },
          entryId: 'e3',
        },
      ])
    })

    it('marks a reused unplaced namesake of a top-level entry top-level', () => {
      const { planned } = buildClassifierActions(
        placesReply([newPlace('new:varn', 'Varn', { parent: 'top-level' })]),
        deps([VARN]),
      )
      expect(planned).toEqual([
        {
          action: {
            kind: 'placeLocation',
            source: 'periodic_classifier',
            payload: {
              branchId: 'branch_1',
              id: 'loc_varn',
              placement: { kind: 'top' },
              proseEntryId: 'e2',
            },
          },
          entryId: 'e2',
        },
      ])
    })

    // An unresolved turn dates the prose at the window's oldest turn, so a user edit made inside
    // the window outranks the pass; the anchor falls back to the newest.
    it('dates the placement of a reused place at the oldest turn when its source turn is unresolved', () => {
      const { planned, fellBackCount } = buildClassifierActions(
        placesReply([newPlace('new:varn', 'Varn', { parent: 'loc_reach', sourceTurn: 't9' })]),
        deps([REACH, VARN]),
      )
      expect(placementsOf(planned)).toEqual([expect.objectContaining({ entryId: 'e3' })])
      expect(payloadOf<{ proseEntryId: string }>(placementsOf(planned)[0]).proseEntryId).toBe('e1')
      expect(fellBackCount).toBe(1)
    })

    it('places a reused place under a new place the reply creates, after its create', () => {
      const { planned } = buildClassifierActions(
        placesReply([
          newPlace('new:reach', 'the Eastern Reach', { parent: 'top-level' }),
          newPlace('new:varn', 'Varn', { parent: 'new:reach' }),
        ]),
        deps([VARN]),
      )
      expect(planned.map((p) => p.action.kind)).toEqual(['createEntity', 'placeLocation'])
      expect(payloadOf<{ placement: unknown }>(placementsOf(planned)[0]).placement).toEqual({
        kind: 'under',
        parentId: 'loc_new1',
      })
    })

    it('drops the placement of a reused place that would close a loop, keeping the reuse', () => {
      const { planned, handleMap, parentDrops } = buildClassifierActions(
        placesReply([newPlace('new:varn', 'Varn', { parent: 'loc_vdocks' })]),
        deps([VARN, placeRow('loc_vdocks', 'Varn Docks', 'loc_varn')]),
      )
      expect(handleMap.get('new:varn')).toBe('loc_varn')
      expect(placementsOf(planned)).toEqual([])
      expect(parentDrops).toEqual([{ handle: 'new:varn', parent: 'loc_vdocks', cause: 'cycle' }])
    })

    it('drops a placement that would close a loop through one the reply placed earlier', () => {
      const { planned, parentDrops } = buildClassifierActions(
        placesReply([
          newPlace('new:a', 'Ash', { parent: 'loc_birch' }),
          newPlace('new:b', 'Birch', { parent: 'new:a' }),
        ]),
        deps([unplacedRow('loc_ash', 'Ash'), unplacedRow('loc_birch', 'Birch')]),
      )
      expect(
        placementsOf(planned).map((p) => payloadOf<{ id: string; placement: unknown }>(p)),
      ).toEqual([
        expect.objectContaining({
          id: 'loc_ash',
          placement: { kind: 'under', parentId: 'loc_birch' },
        }),
      ])
      expect(parentDrops).toEqual([{ handle: 'new:b', parent: 'loc_ash', cause: 'cycle' }])
    })

    // piggyback.md → Matching before creating: places under different real parents are distinct.
    describe("later creates against this reply's placements", () => {
      const INN = placeRow('loc_inn', 'the Inn', null)
      const KEEP = placeRow('loc_keep', 'the Keep', null)
      const CELLAR = unplacedRow('loc_cellar', 'the Cellar')

      it('reuses and places an unplaced place once, creating the namesake under another parent', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_inn' }),
            newPlace('new:b', 'the Cellar', { parent: 'loc_keep' }),
          ]),
          deps([INN, KEEP, CELLAR, placeRow('loc_stairs', 'the Cellar Stairs', 'loc_keep')]),
        )
        expect(handleMap.get('new:a')).toBe('loc_cellar')
        expect(handleMap.get('new:b')).toBe('loc_new1')
        expect(
          placementsOf(planned).map((p) => payloadOf<{ id: string; placement: unknown }>(p)),
        ).toEqual([
          expect.objectContaining({
            id: 'loc_cellar',
            placement: { kind: 'under', parentId: 'loc_inn' },
          }),
        ])
        expect(createdPlaces(planned)).toEqual([
          expect.objectContaining({
            id: 'loc_new1',
            state: { parent_location_id: 'loc_keep' },
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'loc_stairs',
            nameCollisionReason: 'same-parent',
          }),
        ])
      })

      it('flags a later create beside the place this reply placed, as that place now sits', () => {
        const { planned } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_inn' }),
            newPlace('new:b', 'the Cellar Stairs', { parent: 'loc_inn' }),
          ]),
          deps([INN, CELLAR]),
        )
        expect(createdPlaces(planned)).toEqual([
          expect.objectContaining({
            name: 'the Cellar Stairs',
            nameCollisionFlag: 1,
            nameCollisionPartnerId: 'loc_cellar',
            nameCollisionReason: 'same-parent',
          }),
        ])
      })

      it('still maps a same-placement twin to the first, placing once', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_inn' }),
            newPlace('new:b', 'The Cellar', { parent: 'loc_inn' }),
          ]),
          deps([INN, CELLAR]),
        )
        expect(handleMap.get('new:b')).toBe('loc_cellar')
        expect(placementsOf(planned)).toHaveLength(1)
        expect(createdPlaces(planned)).toEqual([])
      })

      it('lets a later create reuse a place whose placement the planner dropped', () => {
        const { planned, handleMap, parentDrops } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_cdocks' }),
            newPlace('new:b', 'the Cellar', { parent: 'loc_keep' }),
          ]),
          deps([KEEP, CELLAR, placeRow('loc_cdocks', 'Cellar Docks', 'loc_cellar')]),
        )
        expect(handleMap.get('new:a')).toBe('loc_cellar')
        expect(handleMap.get('new:b')).toBe('loc_cellar')
        expect(
          placementsOf(planned).map((p) => payloadOf<{ id: string; placement: unknown }>(p)),
        ).toEqual([
          expect.objectContaining({
            id: 'loc_cellar',
            placement: { kind: 'under', parentId: 'loc_keep' },
          }),
        ])
        expect(createdPlaces(planned)).toEqual([])
        expect(parentDrops).toEqual([{ handle: 'new:a', parent: 'loc_cdocks', cause: 'cycle' }])
      })
    })
  })

  describe('flags', () => {
    const flagOf = (planned: readonly PlannedWrite[]) => {
      const [row] = createdPlaces(planned)
      return [row.nameCollisionFlag, row.nameCollisionPartnerId, row.nameCollisionReason]
    }

    it('never reuses a retired namesake: it creates the row flagged against it', () => {
      const ruin = placeRow('loc_ruin', 'The Old Mill', 'loc_town', {
        status: 'retired',
        createdAt: 9,
      })
      const contained = placeRow('loc_old', 'Old Mill Lane', 'loc_town', { createdAt: 1 })
      const { planned } = buildClassifierActions(
        placesReply([newPlace('new:mill', 'The Old Mill', { parent: 'loc_town' })]),
        deps([TOWN, contained, ruin]),
      )
      expect(flagOf(planned)).toEqual([1, 'loc_ruin', 'same-parent'])
    })

    it('creates an unplaced place flagged unplaced when several places share its name', () => {
      const elsewhere = unplacedRow('loc_mill2', 'The Old Mill', { createdAt: 2 })
      const { planned } = buildClassifierActions(
        placesReply([newPlace('new:mill', 'The Old Mill')]),
        deps([TOWN, placeRow('loc_mill', 'The Old Mill', 'loc_town'), elsewhere]),
      )
      expect(flagOf(planned)).toEqual([1, 'loc_mill2', 'unplaced'])
      expect(stateOf(planned, 'The Old Mill')).toEqual({ parent_location_id: null, unplaced: true })
    })

    it('flags a contained name', () => {
      const { planned } = buildClassifierActions(
        placesReply([newPlace('new:mill', 'Mill', { parent: 'loc_town' })]),
        deps([TOWN, placeRow('loc_old', 'Old Mill', 'loc_town')]),
      )
      expect(flagOf(planned)).toEqual([1, 'loc_old', 'same-parent'])
    })

    it("flags a sibling named among the entry's keywords, or whose keywords hold its name", () => {
      const ford = placeRow('loc_ford', 'Grey Ford', 'loc_town', { keywords: ['the crossing'] })
      const byEntry = buildClassifierActions(
        placesReply([
          newPlace('new:x', 'Ashwater', { parent: 'loc_town', keywords: ['grey ford'] }),
        ]),
        deps([TOWN, ford]),
      )
      expect(flagOf(byEntry.planned)).toEqual([1, 'loc_ford', 'same-parent'])
      const bySibling = buildClassifierActions(
        placesReply([newPlace('new:x', 'The Crossing', { parent: 'loc_town' })]),
        deps([TOWN, ford]),
      )
      expect(flagOf(bySibling.planned)).toEqual([1, 'loc_ford', 'same-parent'])
    })
  })

  describe('one reply', () => {
    it('maps a second place with the same name and parent to the first, appending its terms', () => {
      const { planned, handleMap } = buildClassifierActions(
        placesReply([
          newPlace('new:a', 'the Gull Inn', { parent: 'loc_town', keywords: ['the gull'] }),
          newPlace('new:b', 'The Gull Inn', {
            parent: 'loc_town',
            keywords: ['the Gull', 'the alehouse'],
            sourceTurn: 't3',
          }),
        ]),
        deps([TOWN]),
      )
      expect(createdPlaces(planned)).toHaveLength(1)
      expect(handleMap.get('new:b')).toBe('loc_new1')
      expect(planned.at(-1)).toEqual({
        action: {
          kind: 'appendEntityKeywords',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'loc_new1',
            keywords: ['the alehouse'],
            proseEntryId: 'e3',
          },
        },
        entryId: 'e3',
      })
    })

    // A reply's creates match as successive replies' would, so one place is one row either way.
    describe('an unplaced place and a placed namesake', () => {
      const KEEP = placeRow('loc_keep', 'the Keep', null)

      it('maps an unplaced place to the namesake the reply placed earlier', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_town' }),
            newPlace('new:b', 'the Cellar'),
          ]),
          deps([TOWN]),
        )
        expect(createdPlaces(planned).map((e) => [e.id, e.state])).toEqual([
          ['loc_new1', { parent_location_id: 'loc_town' }],
        ])
        expect(handleMap.get('new:b')).toBe('loc_new1')
        expect(placementsOf(planned)).toEqual([])
      })

      // The reply's order decides "earlier", not how it ordered a parent and its child.
      it('counts a placed namesake listed earlier, though its parent is listed after it', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Docks', { parent: 'new:p' }),
            newPlace('new:p', 'the Pier', { parent: 'loc_port' }),
            newPlace('new:b', 'the Docks'),
          ]),
          deps([
            placeRow('loc_bay', 'the Bay', null),
            placeRow('loc_port', 'the Port', null),
            placeRow('loc_docks', 'the Docks', 'loc_bay'),
          ]),
        )
        expect(
          createdPlaces(planned).map((e) => [
            e.id,
            e.state,
            e.nameCollisionPartnerId,
            e.nameCollisionReason,
          ]),
        ).toEqual([
          ['loc_new1', { parent_location_id: 'loc_port' }, null, null],
          ['loc_new2', { parent_location_id: 'loc_new1' }, null, null],
          ['loc_new3', { parent_location_id: null, unplaced: true }, 'loc_docks', 'unplaced'],
        ])
        expect(handleMap.get('new:b')).toBe('loc_new3')
      })

      it('takes over an unplaced place the reply created earlier, placing it after its create', () => {
        const { planned, handleMap, parentDrops } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:b', 'The Cellar', { parent: 'loc_town', sourceTurn: 't3' }),
          ]),
          deps([TOWN]),
        )
        expect(createdPlaces(planned).map((e) => [e.id, e.state, e.nameCollisionFlag])).toEqual([
          ['loc_new1', { parent_location_id: null, unplaced: true }, 0],
        ])
        expect(handleMap.get('new:a')).toBe('loc_new1')
        expect(handleMap.get('new:b')).toBe('loc_new1')
        expect(planned.map((p) => p.action.kind)).toEqual(['createEntity', 'placeLocation'])
        expect(placementsOf(planned)).toEqual([
          {
            action: {
              kind: 'placeLocation',
              source: 'periodic_classifier',
              payload: {
                branchId: 'branch_1',
                id: 'loc_new1',
                placement: { kind: 'under', parentId: 'loc_town' },
                proseEntryId: 'e3',
              },
            },
            entryId: 'e3',
          },
        ])
        expect(parentDrops).toEqual([])
      })

      it('places a taken-over create under a parent the reply creates after it', () => {
        const { planned } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:b', 'the Cellar', { parent: 'new:inn' }),
            newPlace('new:inn', 'the Inn', { parent: 'loc_town' }),
          ]),
          deps([TOWN]),
        )
        expect(createdPlaces(planned).map((e) => e.id)).toEqual(['loc_new1', 'loc_new2'])
        expect(planned.map((p) => p.action.kind)).toEqual([
          'createEntity',
          'createEntity',
          'placeLocation',
        ])
        expect(payloadOf<{ id: string; placement: unknown }>(placementsOf(planned)[0])).toEqual(
          expect.objectContaining({
            id: 'loc_new1',
            placement: { kind: 'under', parentId: 'loc_new2' },
          }),
        )
      })

      it('takes a place over once: a later namesake under another parent is its own row', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:b', 'the Cellar', { parent: 'loc_town' }),
            newPlace('new:c', 'the Cellar'),
            newPlace('new:d', 'the Cellar', { parent: 'loc_keep' }),
          ]),
          deps([TOWN, KEEP]),
        )
        expect(['new:a', 'new:b', 'new:c', 'new:d'].map((h) => handleMap.get(h))).toEqual([
          'loc_new1',
          'loc_new1',
          'loc_new1',
          'loc_new2',
        ])
        expect(createdPlaces(planned).map((e) => [e.id, e.state, e.nameCollisionFlag])).toEqual([
          ['loc_new1', { parent_location_id: null, unplaced: true }, 0],
          ['loc_new2', { parent_location_id: 'loc_keep' }, 0],
        ])
        expect(placementsOf(planned)).toHaveLength(1)
      })

      // The twin is keyed on what each create declared, whatever a takeover did to the row since.
      it('maps an unplaced place to an earlier unplaced twin a namesake took over and placed', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:b', 'the Cellar', { parent: 'loc_town' }),
            newPlace('new:c', 'the Cellar'),
            newPlace('new:d', 'the Cellar', { parent: 'loc_inn' }),
          ]),
          deps([
            TOWN,
            KEEP,
            placeRow('loc_mill', 'the Mill', null),
            placeRow('loc_inn', 'the Inn', null),
            placeRow('loc_cellar', 'the Cellar', 'loc_keep'),
            placeRow('loc_cellar2', 'the Cellar', 'loc_mill', { createdAt: 2 }),
          ]),
        )
        expect(['new:a', 'new:b', 'new:c', 'new:d'].map((h) => handleMap.get(h))).toEqual([
          'loc_new1',
          'loc_new1',
          'loc_new1',
          'loc_new2',
        ])
        expect(
          placementsOf(planned).map((p) => payloadOf<{ id: string; placement: unknown }>(p)),
        ).toEqual([
          expect.objectContaining({
            id: 'loc_new1',
            placement: { kind: 'under', parentId: 'loc_town' },
          }),
        ])
        expect(createdPlaces(planned).map((e) => [e.id, e.state, e.nameCollisionFlag])).toEqual([
          ['loc_new1', { parent_location_id: null, unplaced: true }, 1],
          ['loc_new2', { parent_location_id: 'loc_inn' }, 0],
        ])
      })

      it('takes a place over once when the first takeover makes it top-level', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:b', 'the Cellar', { parent: 'top-level' }),
            newPlace('new:c', 'the Cellar', { parent: 'loc_keep' }),
          ]),
          deps([TOWN, KEEP]),
        )
        expect(['new:a', 'new:b', 'new:c'].map((h) => handleMap.get(h))).toEqual([
          'loc_new1',
          'loc_new1',
          'loc_new2',
        ])
        expect(
          placementsOf(planned).map((p) => payloadOf<{ id: string; placement: unknown }>(p)),
        ).toEqual([expect.objectContaining({ id: 'loc_new1', placement: { kind: 'top' } })])
      })

      it('never takes over a placed create an unplaced namesake mapped to', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_town' }),
            newPlace('new:b', 'the Cellar'),
            newPlace('new:c', 'the Cellar', { parent: 'loc_keep' }),
          ]),
          deps([TOWN, KEEP]),
        )
        expect(['new:a', 'new:b', 'new:c'].map((h) => handleMap.get(h))).toEqual([
          'loc_new1',
          'loc_new1',
          'loc_new2',
        ])
        expect(placementsOf(planned)).toEqual([])
      })

      it('creates an unplaced place flagged when a row and an earlier create share its name', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar', { parent: 'loc_keep' }),
            newPlace('new:b', 'the Cellar'),
          ]),
          deps([TOWN, KEEP, placeRow('loc_cellar', 'the Cellar', 'loc_town')]),
        )
        expect(handleMap.get('new:b')).toBe('loc_new2')
        expect(
          createdPlaces(planned).map((e) => [
            e.id,
            e.state,
            e.nameCollisionFlag,
            e.nameCollisionPartnerId,
            e.nameCollisionReason,
          ]),
        ).toEqual([
          ['loc_new1', { parent_location_id: 'loc_keep' }, 0, null, null],
          ['loc_new2', { parent_location_id: null, unplaced: true }, 1, 'loc_cellar', 'unplaced'],
        ])
      })

      it('maps a second unplaced place to the first when several rows share its name', () => {
        const { planned, handleMap } = buildClassifierActions(
          placesReply([newPlace('new:a', 'the Cellar'), newPlace('new:b', 'The Cellar')]),
          deps([
            TOWN,
            KEEP,
            placeRow('loc_cellar', 'the Cellar', 'loc_town'),
            placeRow('loc_cellar2', 'the Cellar', 'loc_keep', { createdAt: 2 }),
          ]),
        )
        expect(
          createdPlaces(planned).map((e) => [
            e.id,
            e.state,
            e.nameCollisionFlag,
            e.nameCollisionPartnerId,
            e.nameCollisionReason,
          ]),
        ).toEqual([
          ['loc_new1', { parent_location_id: null, unplaced: true }, 1, 'loc_cellar', 'unplaced'],
        ])
        expect(handleMap.get('new:b')).toBe('loc_new1')
      })

      it("drops a takeover's placement into the taken-over place's own subtree, as one row", () => {
        const { planned, handleMap, parentDrops } = buildClassifierActions(
          placesReply([
            newPlace('new:a', 'the Cellar'),
            newPlace('new:rack', 'the Wine Rack', { parent: 'new:a' }),
            newPlace('new:b', 'the Cellar', { parent: 'new:rack' }),
          ]),
          deps([TOWN]),
        )
        expect(createdPlaces(planned).map((e) => [e.id, e.state])).toEqual([
          ['loc_new1', { parent_location_id: null, unplaced: true }],
          ['loc_new2', { parent_location_id: 'loc_new1' }],
        ])
        expect(handleMap.get('new:b')).toBe('loc_new1')
        expect(placementsOf(planned)).toEqual([])
        expect(parentDrops).toEqual([{ handle: 'new:b', parent: 'loc_new2', cause: 'cycle' }])
      })
    })

    it('keeps a handle bound to the newCharacters entry that claimed it, and the first place', () => {
      const { planned, handleMap, unresolvedRefs, droppedPlaces } = buildClassifierActions(
        placesReply(
          [
            newPlace('new:x', 'Ashwater'),
            newPlace('new:y', 'Birchmoor'),
            newPlace('new:y', 'Coldharbour'),
          ],
          {
            newCharacters: [
              {
                handle: 'new:x',
                name: 'Xan',
                description: 'A smith.',
                keywords: [],
                sourceTurn: 't1',
              },
            ],
          },
        ),
        deps([], { decisions: new Map([['new:x', { kind: 'create', flag: null }]]) }),
      )
      expect(createdPlaces(planned).map((e) => e.name)).toEqual(['Birchmoor'])
      expect(handleMap.get('new:x')).toMatch(/^char_/)
      expect(droppedPlaces).toEqual([
        { handle: 'new:x', name: 'Ashwater', cause: 'handle-taken' },
        { handle: 'new:y', name: 'Coldharbour', cause: 'handle-taken' },
      ])
      expect(unresolvedRefs).toEqual([])
    })

    it('keeps a handle bound to the newFactions entry that claimed it', () => {
      const { planned, handleMap, unresolvedRefs, droppedPlaces } = buildClassifierActions(
        placesReply([newPlace('new:x', 'Ashwater')], {
          newFactions: [
            {
              handle: 'new:x',
              name: 'The Ash Guild',
              description: 'Ferrymen.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
        }),
        deps([], { factionDecisions: new Map([['new:x', { kind: 'create', flag: null }]]) }),
      )
      expect(createdPlaces(planned)).toEqual([])
      expect(handleMap.get('new:x')).toMatch(/^fact_/)
      expect(droppedPlaces).toEqual([{ handle: 'new:x', name: 'Ashwater', cause: 'handle-taken' }])
      expect(unresolvedRefs).toEqual([])
    })

    it('drops a blank-named place and reports it', () => {
      const { planned, unresolvedRefs, droppedPlaces } = buildClassifierActions(
        placesReply([newPlace('new:x', '   ')]),
        deps([]),
      )
      expect(planned).toEqual([])
      expect(droppedPlaces).toEqual([{ handle: 'new:x', name: '   ', cause: 'blank-name' }])
      expect(unresolvedRefs).toEqual([])
    })

    it("resolves a new place's handle as a site, never as a character", () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        placesReply([newPlace('new:inn', 'the Gull Inn')], {
          happenings: [
            {
              title: 'A brawl',
              sourceTurn: 't2',
              involvements: [{ ref: 'new:inn', role: 'site' }],
              awareness: [{ ref: 'new:inn', source: 'saw it', severity: 0.5 }],
            },
          ],
        }),
        deps([]),
      )
      const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
      expect(payloadOf<{ entry: { entityId: string } }>(involvement).entry.entityId).toBe(
        'loc_new1',
      )
      expect(planned.some((p) => p.action.kind === 'upsertHappeningAwareness')).toBe(false)
      expect(unresolvedRefs).toEqual(['new:inn'])
      // The create precedes every write that names it.
      expect(planned.findIndex((p) => p.action.kind === 'createEntity')).toBeLessThan(
        planned.indexOf(involvement as PlannedWrite),
      )
    })
  })
})

// classifier.md → Factions.
describe('factions', () => {
  const factionRow = (id: string, status = 'active', keywords: string[] = []) =>
    ({
      id,
      branchId: 'branch_1',
      kind: 'faction',
      name: id,
      description: 'x',
      status,
      keywords,
      state: {},
    }) as never
  const member = (id: string, factionId: string | null) =>
    ({
      id,
      branchId: 'branch_1',
      kind: 'character',
      name: id,
      description: 'x',
      status: 'active',
      keywords: [],
      state: { faction_id: factionId },
    }) as never
  const deps = (entities: Entity[], over: Partial<typeof base> = {}) => {
    let n = 0
    return {
      ...base,
      entities: entities as never[],
      newId: (kind: string) => `${kind}_new${++n}`,
      ...over,
    }
  }
  const circle = {
    handle: 'new:circle',
    name: 'The Iron Circle',
    description: 'Smiths who answer to no lord.',
    keywords: ['the Circle'],
    sourceTurn: 't2',
  }
  const decided = (decision: ReconcileDecision, handle = 'new:circle') =>
    new Map<string, ReconcileDecision>([[handle, decision]])
  const create = { kind: 'create', flag: null } as const
  type FactionWrite = { id: string; factionId: string | null; proseEntryId: string | null }
  const memberships = (planned: readonly PlannedWrite[]) =>
    planned
      .filter((p) => p.action.kind === 'setCharacterFaction')
      .map((p) => ({ ...payloadOf<FactionWrite>(p), entryId: p.entryId }))
  const kinds = (planned: readonly PlannedWrite[]) => planned.map((p) => p.action.kind)

  describe('new factions', () => {
    it('creates an active, auto faction from the prose, stale, anchored on its turn', () => {
      const { planned, handleMap } = buildClassifierActions(
        reply({ newFactions: [circle] }),
        deps([], { factionDecisions: decided(create) } as never),
      )
      expect(planned).toHaveLength(1)
      const { entry } = payloadOf<{ entry: Record<string, unknown> }>(planned[0])
      expect(entry).toMatchObject({
        id: 'fact_new1',
        kind: 'faction',
        name: 'The Iron Circle',
        description: 'Smiths who answer to no lord.',
        keywords: ['the Circle'],
        status: 'active',
        injectionMode: 'auto',
        nameCollisionFlag: 0,
        nameCollisionPartnerId: null,
        nameCollisionReason: null,
        embeddingStale: 1,
      })
      // classifier.md → Factions → The row: its state is empty when the turns gave none.
      expect(entry.state).toEqual({})
      expect(planned[0].entryId).toBe('e2')
      expect(handleMap.get('new:circle')).toBe('fact_new1')
    })

    it('stores the flag its decision carries', () => {
      const { planned } = buildClassifierActions(
        reply({ newFactions: [circle] }),
        deps([factionRow('fact_old')], {
          factionDecisions: decided({
            kind: 'create',
            flag: { partnerId: 'fact_old', reason: 'ambiguous' },
          }),
        } as never),
      )
      expect(payloadOf<{ entry: Record<string, unknown> }>(planned[0]).entry).toMatchObject({
        nameCollisionFlag: 1,
        nameCollisionPartnerId: 'fact_old',
        nameCollisionReason: 'ambiguous',
      })
    })

    it("clamps the name and description as a new character's are", () => {
      const { planned } = buildClassifierActions(
        reply({
          newFactions: [{ ...circle, name: `  ${'N'.repeat(130)}`, description: 'D'.repeat(1300) }],
        }),
        deps([], { factionDecisions: decided(create) } as never),
      )
      const { entry } = payloadOf<{ entry: { name: string; description: string } }>(planned[0])
      expect(entry.name).toBe('N'.repeat(120))
      expect(entry.description).toBe('D'.repeat(1200))
    })

    it('promotes a staged faction it absorbs and appends only its new keywords', () => {
      const { planned, handleMap } = buildClassifierActions(
        reply({ newFactions: [{ ...circle, keywords: ['the Circle', 'the smiths'] }] }),
        deps([factionRow('fact_old', 'staged', ['the smiths'])], {
          factionDecisions: decided({ kind: 'promote', entityId: 'fact_old', similarity: 0.9 }),
        } as never),
      )
      expect(kinds(planned)).toEqual(['promoteStagedEntity', 'appendEntityKeywords'])
      expect(payloadOf<{ keywords: string[] }>(planned[1]).keywords).toEqual(['the Circle'])
      expect(handleMap.get('new:circle')).toBe('fact_old')
    })

    it('appends the new keywords of a faction it absorbs into a listed one', () => {
      const { planned } = buildClassifierActions(
        reply({ newFactions: [circle] }),
        deps([factionRow('fact_old')], {
          factionDecisions: decided({ kind: 'known', entityId: 'fact_old', similarity: 0.9 }),
        } as never),
      )
      expect(kinds(planned)).toEqual(['appendEntityKeywords'])
      expect(payloadOf<{ id: string }>(planned[0]).id).toBe('fact_old')
    })

    it("keeps a handle a new character claimed, ignoring the faction's decision for it", () => {
      const { planned, handleMap, unresolvedRefs } = buildClassifierActions(
        reply({
          newCharacters: [{ ...circle, name: 'Circe' }],
          newFactions: [circle],
        }),
        deps([], { decisions: decided(create), factionDecisions: decided(create) } as never),
      )
      expect(planned).toHaveLength(1)
      expect(payloadOf<{ entry: { kind: string } }>(planned[0]).entry.kind).toBe('character')
      expect(handleMap.get('new:circle')).toBe('char_new1')
      expect(unresolvedRefs).toEqual(['new:circle'])
    })

    it("decides a faction by its own decision, never the character's for its handle", () => {
      const { planned, handleMap } = buildClassifierActions(
        reply({ newFactions: [circle] }),
        deps([member('char_kael', null)], {
          decisions: decided({ kind: 'known', entityId: 'char_kael', similarity: 0.9 }),
          factionDecisions: decided(create),
        } as never),
      )
      expect(kinds(planned)).toEqual(['createEntity'])
      expect(handleMap.get('new:circle')).toBe('fact_new1')
    })

    it("resolves a happening's involvement naming the new faction's handle", () => {
      const { planned } = buildClassifierActions(
        reply({
          newFactions: [circle],
          happenings: [
            {
              title: 'The Circle takes the forge',
              sourceTurn: 't2',
              involvements: [{ ref: 'new:circle', role: 'claimant' }],
              awareness: [],
            },
          ],
        }),
        deps([], { factionDecisions: decided(create) } as never),
      )
      expect(kinds(planned)).toEqual([
        'createEntity',
        'createHappening',
        'createHappeningInvolvement',
      ])
      expect(payloadOf<{ entry: { entityId: string } }>(planned[2]).entry.entityId).toBe(
        'fact_new1',
      )
    })

    it('reports a faction with no decision or a blank name, creating nothing', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({ newFactions: [circle, { ...circle, handle: 'new:blank', name: '  ' }] }),
        deps([], { factionDecisions: decided(create, 'new:blank') } as never),
      )
      expect(planned).toEqual([])
      expect(unresolvedRefs).toEqual(['new:circle', 'new:blank'])
    })
  })

  describe('memberships', () => {
    it("sets a listed character's faction, anchored and dated on its turn", () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [{ character: 'char_kael', faction: 'fact_crown', sourceTurn: 't2' }],
        }),
        deps([member('char_kael', null), factionRow('fact_crown')]),
      )
      expect(memberships(planned)).toEqual([
        {
          branchId: 'branch_1',
          id: 'char_kael',
          factionId: 'fact_crown',
          proseEntryId: 'e2',
          entryId: 'e2',
        },
      ])
    })

    it('clears a faction with a null fact, and plans nothing for one that matches', () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [
            { character: 'char_kael', faction: null, sourceTurn: 't1' },
            { character: 'char_aria', faction: 'fact_crown', sourceTurn: 't1' },
          ],
        }),
        deps([
          member('char_kael', 'fact_crown'),
          member('char_aria', 'fact_crown'),
          factionRow('fact_crown'),
        ]),
      )
      expect(memberships(planned).map(({ id, factionId }) => [id, factionId])).toEqual([
        ['char_kael', null],
      ])
    })

    it('writes a join and a later leave both, in turn order, ties in reply order', () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [
            { character: 'char_kael', faction: null, sourceTurn: 't3' },
            { character: 'char_kael', faction: 'fact_crown', sourceTurn: 't1' },
            { character: 'char_aria', faction: 'fact_crown', sourceTurn: 't2' },
            { character: 'char_aria', faction: null, sourceTurn: 't2' },
          ],
        }),
        deps([member('char_kael', null), member('char_aria', null), factionRow('fact_crown')]),
      )
      expect(
        memberships(planned).map(({ id, factionId, entryId }) => [id, factionId, entryId]),
      ).toEqual([
        ['char_kael', 'fact_crown', 'e1'],
        ['char_aria', 'fact_crown', 'e2'],
        ['char_aria', null, 'e2'],
        ['char_kael', null, 'e3'],
      ])
    })

    // The handler can refuse the earlier write (a user edit between the turns), so only the
    // stored faction, never a planned one, can rule a later fact out.
    it('keeps a fact restating an earlier planned one, so a refused write cannot hide it', () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [
            { character: 'char_kael', faction: 'fact_circle', sourceTurn: 't1' },
            { character: 'char_kael', faction: 'fact_circle', sourceTurn: 't2' },
          ],
        }),
        deps([
          member('char_kael', 'fact_crown'),
          factionRow('fact_crown'),
          factionRow('fact_circle'),
        ]),
      )
      expect(
        memberships(planned).map(({ factionId, proseEntryId }) => [factionId, proseEntryId]),
      ).toEqual([
        ['fact_circle', 'e1'],
        ['fact_circle', 'e2'],
      ])
    })

    it('sorts a fact whose turn does not resolve at the window head, dated by the oldest turn', () => {
      const { planned, fellBackCount } = buildClassifierActions(
        reply({
          memberships: [
            { character: 'char_kael', faction: 'fact_b', sourceTurn: 'bogus' },
            { character: 'char_kael', faction: null, sourceTurn: 't1' },
          ],
        }),
        deps([member('char_kael', 'fact_a'), factionRow('fact_a'), factionRow('fact_b')]),
      )
      expect(
        memberships(planned).map(({ factionId, entryId, proseEntryId }) => [
          factionId,
          entryId,
          proseEntryId,
        ]),
      ).toEqual([
        [null, 'e1', 'e1'],
        ['fact_b', 'e3', 'e1'],
      ])
      expect(fellBackCount).toBe(1)
    })

    it('names a character and a faction the same reply creates, after both creates', () => {
      const { planned } = buildClassifierActions(
        reply({
          newCharacters: [
            {
              handle: 'new:mara',
              name: 'Mara',
              description: 'A smith.',
              keywords: [],
              sourceTurn: 't1',
            },
          ],
          newFactions: [circle],
          memberships: [{ character: 'new:mara', faction: 'new:circle', sourceTurn: 't2' }],
        }),
        deps([], {
          decisions: decided(create, 'new:mara'),
          factionDecisions: decided(create),
        } as never),
      )
      expect(kinds(planned)).toEqual(['createEntity', 'createEntity', 'setCharacterFaction'])
      expect(memberships(planned)[0]).toMatchObject({ id: 'char_new1', factionId: 'fact_new2' })
    })

    it.each([
      ['names no row', 'fact_gone'],
      ['names a character', 'char_aria'],
      ['is blank', ' '],
    ])('drops a fact whose faction %s, never reading it as none', (_label, faction) => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({ memberships: [{ character: 'char_kael', faction, sourceTurn: 't1' }] }),
        deps([
          member('char_kael', 'fact_crown'),
          member('char_aria', null),
          factionRow('fact_crown'),
        ]),
      )
      expect(memberships(planned)).toEqual([])
      expect(unresolvedRefs).toEqual([faction])
    })

    it('drops a fact whose character is not a character', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({ memberships: [{ character: 'fact_crown', faction: null, sourceTurn: 't1' }] }),
        deps([factionRow('fact_crown')]),
      )
      expect(planned).toEqual([])
      expect(unresolvedRefs).toEqual(['fact_crown'])
    })

    it('drops a fact naming a faction absorbed into a row deleted before planning', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          newFactions: [circle],
          memberships: [{ character: 'char_kael', faction: 'new:circle', sourceTurn: 't2' }],
        }),
        deps([member('char_kael', null)], {
          factionDecisions: decided({ kind: 'known', entityId: 'fact_deleted', similarity: 0.9 }),
        } as never),
      )
      expect(memberships(planned)).toEqual([])
      expect(unresolvedRefs).toContain('new:circle')
    })

    it('drops and reports a fact naming a faction retired before the reply', () => {
      const { planned, droppedMemberships } = buildClassifierActions(
        reply({ memberships: [{ character: 'char_kael', faction: 'fact_old', sourceTurn: 't1' }] }),
        deps([member('char_kael', null), factionRow('fact_old', 'retired')]),
      )
      expect(memberships(planned)).toEqual([])
      expect(droppedMemberships).toEqual([
        { character: 'char_kael', faction: 'fact_old', cause: 'retired-faction' },
      ])
    })

    it('keeps a membership to a faction the same reply retires', () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [{ character: 'char_kael', faction: 'fact_crown', sourceTurn: 't1' }],
          statusFlips: [{ ref: 'fact_crown', to: 'retired', sourceTurn: 't2' }],
        }),
        deps([member('char_kael', null), factionRow('fact_crown')]),
      )
      expect(kinds(planned)).toEqual(['setCharacterFaction', 'retireEntity'])
    })

    it('takes a member into a staged faction without promoting it', () => {
      const { planned } = buildClassifierActions(
        reply({
          memberships: [{ character: 'char_kael', faction: 'fact_hidden', sourceTurn: 't1' }],
        }),
        deps([member('char_kael', null), factionRow('fact_hidden', 'staged')]),
      )
      expect(kinds(planned)).toEqual(['setCharacterFaction'])
    })

    it('clears a faction id that names no row when a fact sets none', () => {
      const { planned } = buildClassifierActions(
        reply({ memberships: [{ character: 'char_kael', faction: null, sourceTurn: 't1' }] }),
        deps([member('char_kael', 'fact_gone')]),
      )
      expect(memberships(planned).map(({ factionId }) => factionId)).toEqual([null])
    })
  })
})

const kindsOf = (planned: readonly PlannedWrite[]) => planned.map((p) => p.action.kind)

// classifier.md → What the classifier writes → First profiles; data-model.md → Soft caps +
// compaction discipline: the state schema's bounds, which the create handler enforces.
describe('first profiles', () => {
  const deps = (over: Record<string, unknown> = {}) => {
    let n = 0
    return { ...base, newId: (kind: string) => `${kind}_new${++n}`, ...over } as never
  }
  const decided = (handle: string) =>
    new Map<string, ReconcileDecision>([[handle, { kind: 'create', flag: null }]])
  const stateOf = (planned: readonly PlannedWrite[]) =>
    payloadOf<{ entry: { state: unknown } }>(planned[0]).entry.state

  const EMPTY_CHARACTER = {
    visual: {},
    traits: [],
    drives: [],
    current_location_id: null,
    equipped_items: [],
    inventory: [],
    faction_id: null,
    lastSeenAt: null,
  }

  it("writes a new character's visual categories, traits, drives and voice into its state", () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:ilsa',
            name: 'Ilsa',
            description: 'A tide-reader.',
            keywords: [],
            sourceTurn: 't1',
            visual: { hair: ' salt-white ', eyes: '', attire: 'an oilskin coat' },
            traits: ['patient', ' Patient ', '', 'blunt'],
            drives: ['find her brother', ' Find her brother ', ' '],
            voice: '  slow, certain  ',
          },
        ],
      }),
      deps({ decisions: decided('new:ilsa') }),
    )
    expect(stateOf(planned)).toEqual({
      ...EMPTY_CHARACTER,
      visual: { hair: 'salt-white', attire: 'an oilskin coat' },
      traits: ['patient', 'blunt'],
      drives: ['find her brother'],
      voice: 'slow, certain',
    })
  })

  it('writes the empty character state when the turns give no profile', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          { handle: 'new:ilsa', name: 'Ilsa', description: 'x', keywords: [], sourceTurn: 't1' },
        ],
      }),
      deps({ decisions: decided('new:ilsa') }),
    )
    expect(stateOf(planned)).toEqual(EMPTY_CHARACTER)
  })

  it('cuts a long visual value at a clause', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:ilsa',
            name: 'Ilsa',
            description: 'x',
            keywords: [],
            sourceTurn: 't1',
            visual: { face: `${'f'.repeat(300)}; ${'g'.repeat(300)}` },
          },
        ],
      }),
      deps({ decisions: decided('new:ilsa') }),
    )
    expect((stateOf(planned) as { visual: { face: string } }).visual.face).toBe('f'.repeat(300))
  })

  it("clamps a profile to the state schema's bounds, never splitting a surrogate pair", () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:ilsa',
            name: 'Ilsa',
            description: 'x',
            keywords: [],
            sourceTurn: 't1',
            visual: { face: `${'f'.repeat(499)}😀tail` },
            traits: Array.from({ length: 60 }, (_, i) => `trait ${i}`),
            voice: 'v'.repeat(2100),
          },
        ],
      }),
      deps({ decisions: decided('new:ilsa') }),
    )
    const state = stateOf(planned) as { visual: { face: string }; traits: string[]; voice: string }
    expect(state.visual.face).toBe('f'.repeat(499))
    expect(state.traits).toHaveLength(50)
    expect(state.traits.at(-1)).toBe('trait 49')
    expect(state.voice).toBe('v'.repeat(2000))
  })

  it("writes a new faction's standing and agenda, bounded, and an empty state for none", () => {
    const circle = {
      handle: 'new:circle',
      name: 'The Iron Circle',
      description: 'Smiths.',
      keywords: [],
      sourceTurn: 't2',
    }
    const withProfile = buildClassifierActions(
      reply({
        newFactions: [
          {
            ...circle,
            standing: ` ${'s'.repeat(510)} `,
            agenda: ['arm the docks', ' ', 'Arm the docks'],
          },
        ],
      }),
      deps({ factionDecisions: decided('new:circle') }),
    )
    expect(stateOf(withProfile.planned)).toEqual({
      standing: 's'.repeat(500),
      agenda: ['arm the docks'],
    })
    const bare = buildClassifierActions(
      reply({ newFactions: [circle] }),
      deps({ factionDecisions: decided('new:circle') }),
    )
    expect(stateOf(bare.planned)).toEqual({})
  })

  it('writes no profile into a row the reconciliation absorbed', () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:ilsa',
            name: 'Ilsa',
            description: 'x',
            keywords: ['the tide-reader'],
            sourceTurn: 't1',
            traits: ['patient'],
          },
        ],
      }),
      deps({
        entities: [
          { id: 'char_ilsa', kind: 'character', name: 'Ilsa', status: 'active', keywords: [] },
        ],
        decisions: new Map([
          ['new:ilsa', { kind: 'known', entityId: 'char_ilsa', similarity: 0.9 }],
        ]),
      }),
    )
    expect(kindsOf(planned)).toEqual(['appendEntityKeywords'])
  })
})

// classifier.md → What the classifier writes → Names. A rename onto a taken name adds it to the
// entity's keywords and flags the pair, so World still pairs the namesakes.
describe('renames', () => {
  const row = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) =>
    ({
      id,
      branchId: 'branch_1',
      kind,
      name,
      description: 'x',
      status: 'active',
      keywords: [],
      nameCollisionFlag: 0,
      createdAt: 1,
      state: {},
      ...over,
    }) as unknown as Entity
  const deps = (entities: Entity[], over: Record<string, unknown> = {}) =>
    ({ ...base, entities, ...over }) as never
  const STRANGER = row('char_stranger', 'character', 'the hooded stranger', {
    keywords: ['the hood'],
  })
  const KAEL = row('char_kael', 'character', 'Kael', { createdAt: 2 })

  it("writes a listed entity's revealed name, anchored and dated on its turn", () => {
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: '  Corvin Vale ', sourceTurn: 't2' }] }),
      deps([STRANGER, KAEL]),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'renameEntity',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'char_stranger',
            name: 'Corvin Vale',
            proseEntryId: 'e2',
          },
        },
        entryId: 'e2',
      },
    ])
    expect(renameClashes).toEqual([])
  })

  it('clamps the name as a create clamps one', () => {
    const { planned } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'N'.repeat(130), sourceTurn: 't1' }] }),
      deps([STRANGER]),
    )
    expect(payloadOf<{ name: string }>(planned[0]).name).toBe('N'.repeat(120))
  })

  it.each([['   '], ['the hooded stranger']])('plans nothing for the name %j', (name) => {
    const { planned } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name, sourceTurn: 't1' }] }),
      deps([STRANGER]),
    )
    expect(planned).toEqual([])
  })

  // renameEntity compares names under keyword-term normalization: a case-only change is no reveal.
  it.each([
    ['alone', [KAEL]],
    ['beside a namesake', [KAEL, row('char_kael_twin', 'character', 'Kael', { createdAt: 0 })]],
  ])('plans nothing for a case-only rename of a row %s', (_label, entities) => {
    const { planned, renameClashes, fellBackCount } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_kael', name: ' KAEL ' }] }),
      deps(entities),
    )
    expect(planned).toEqual([])
    expect(renameClashes).toEqual([])
    expect(fellBackCount).toBe(0)
  })

  // World's namesake rule splits a name on whitespace, and renameEntity refuses by the same rule.
  it('plans nothing for a rename that changes only the spacing inside the name', () => {
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_kael', name: 'Kael \n Stormborn', sourceTurn: 't1' }] }),
      deps([row('char_kael', 'character', 'Kael Stormborn')]),
    )
    expect(planned).toEqual([])
    expect(renameClashes).toEqual([])
  })

  it('takes a name spaced apart from the one another row holds as that name', () => {
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael  Stormborn', sourceTurn: 't1' }] }),
      deps([STRANGER, row('char_kael', 'character', 'Kael Stormborn', { createdAt: 2 })]),
    )
    expect(planned.map((p) => p.action.kind)).toEqual([
      'appendEntityKeywords',
      'raiseCollisionFlag',
    ])
    expect(renameClashes).toEqual([
      { ref: 'char_stranger', name: 'Kael  Stormborn', partnerId: 'char_kael', flagged: true },
    ])
  })

  it('adds a name another row of the kind holds as a keyword and flags the pair name-taken', () => {
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: ' kael ', sourceTurn: 't3' }] }),
      deps([STRANGER, KAEL]),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'appendEntityKeywords',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'char_stranger',
            keywords: ['kael'],
            proseEntryId: 'e3',
          },
        },
        entryId: 'e3',
      },
      {
        action: {
          kind: 'raiseCollisionFlag',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'char_stranger',
            partnerId: 'char_kael',
            reason: 'name-taken',
            proseEntryId: 'e3',
          },
        },
        entryId: 'e3',
      },
    ])
    expect(renameClashes).toEqual([
      { ref: 'char_stranger', name: 'kael', partnerId: 'char_kael', flagged: true },
    ])
  })

  // A keyword write's undo is the whole prior list, so a row's keyword writes plan in turn order;
  // a clash's raise still follows its own keyword.
  it("plans a row's keyword writes in turn order, the clash's raise after its keyword", () => {
    const { planned } = buildClassifierActions(
      reply({
        renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't3' }],
        aliases: [{ ref: 'char_stranger', terms: ['the fence'], sourceTurn: 't1' }],
      }),
      deps([STRANGER, KAEL]),
    )
    expect(planned.map((p) => [p.action.kind, p.entryId])).toEqual([
      ['appendEntityKeywords', 'e1'],
      ['appendEntityKeywords', 'e3'],
      ['raiseCollisionFlag', 'e3'],
    ])
  })

  // Within one turn a row's keyword writes keep the reply's step order: a mention's terms, then
  // the rename, then an alias.
  it("plans one turn's mention terms, rename and alias of a row in that order", () => {
    const { planned } = buildClassifierActions(
      reply({
        newCharacters: [
          {
            handle: 'new:corvin',
            name: 'Corvin',
            description: 'x',
            keywords: ['Corvin', 'the cloaked man'],
            sourceTurn: 't2',
          },
        ],
        aliases: [{ ref: 'char_stranger', terms: ['the fence'], sourceTurn: 't2' }],
        renames: [{ ref: 'char_stranger', name: 'Corvin', sourceTurn: 't2' }],
      }),
      deps([STRANGER], {
        decisions: new Map([
          ['new:corvin', { kind: 'known', entityId: 'char_stranger', similarity: 0.9 }],
        ]),
      }),
    )
    expect(
      planned.map((p) => [p.action.kind, payloadOf<{ keywords?: string[] }>(p).keywords]),
    ).toEqual([
      ['appendEntityKeywords', ['Corvin', 'the cloaked man']],
      ['renameEntity', undefined],
      ['appendEntityKeywords', ['the fence']],
    ])
  })

  it("keeps a clash's keyword for the rest of the reply", () => {
    const { planned } = buildClassifierActions(
      reply({
        renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' }],
        aliases: [{ ref: 'char_stranger', terms: ['kael'], sourceTurn: 't2' }],
      }),
      deps([STRANGER, KAEL]),
    )
    expect(kindsOf(planned)).toEqual(['appendEntityKeywords', 'raiseCollisionFlag'])
  })

  it('only adds the keyword to a row already flagged, keeping its partner', () => {
    const flagged = row('char_stranger', 'character', 'the hooded stranger', {
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_other',
      nameCollisionReason: 'distinct',
    })
    const other = row('char_other', 'character', 'the hooded stranger', { createdAt: 0 })
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' }] }),
      deps([flagged, KAEL, other]),
    )
    expect(kindsOf(planned)).toEqual(['appendEntityKeywords'])
    expect(renameClashes).toEqual([
      { ref: 'char_stranger', name: 'Kael', partnerId: 'char_kael', flagged: false },
    ])
  })

  // classifier.md → Names: a flag whose pair World's rule no longer holds counts as none.
  it.each([
    ['a partner it shares no name with', [row('char_other', 'character', 'Zed')]],
    ['a partner that is gone', []],
  ])('re-points a flag dormant on %s at the holder', (_label, others) => {
    const dormant = row('char_stranger', 'character', 'the hooded stranger', {
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_other',
      nameCollisionReason: 'distinct',
    })
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' }] }),
      deps([dormant, KAEL, ...others]),
    )
    expect(kindsOf(planned)).toEqual(['appendEntityKeywords', 'raiseCollisionFlag'])
    expect(payloadOf<{ partnerId: string }>(planned[1]).partnerId).toBe('char_kael')
    expect(renameClashes.map((c) => c.flagged)).toEqual([true])
  })

  // The clash's keyword lands before the raise, so a flag it brings back to life keeps its partner.
  it("keeps a dormant flag the clash's own keyword brings back to life", () => {
    const dormant = row('char_stranger', 'character', 'the hooded stranger', {
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_kael_old',
      nameCollisionReason: 'distinct',
    })
    const { planned, renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' }] }),
      deps([dormant, KAEL, row('char_kael_old', 'character', 'Kael', { createdAt: 3 })]),
    )
    expect(kindsOf(planned)).toEqual(['appendEntityKeywords'])
    expect(renameClashes.map((c) => c.flagged)).toEqual([false])
  })

  it('takes the oldest holder as the partner, then the lowest id', () => {
    const { renameClashes } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' }] }),
      deps([
        STRANGER,
        KAEL,
        row('char_kael_b', 'character', 'Kael', { createdAt: 0 }),
        row('char_kael_a', 'character', 'KAEL', { createdAt: 0 }),
      ]),
    )
    expect(renameClashes.map((c) => c.partnerId)).toEqual(['char_kael_a'])
  })

  it('renames freely to a name only a row of another kind holds', () => {
    const { planned } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Varn', sourceTurn: 't1' }] }),
      deps([STRANGER, row('loc_varn', 'location', 'Varn')]),
    )
    expect(kindsOf(planned)).toEqual(['renameEntity'])
  })

  // piggyback.md → Matching before creating: places under different real parents are never
  // compared; an unplaced place is compared with every place.
  describe('of a place', () => {
    const place = (id: string, name: string, state: Record<string, unknown>, createdAt = 1) =>
      row(id, 'location', name, { state, createdAt })
    const under = (parent: string) => ({ parent_location_id: parent })
    const UNPLACED = { parent_location_id: null, unplaced: true }
    // Two parents: the North, inside the Reach, and the top-level South.
    const PARENTS = [
      place('loc_reach', 'the Reach', {}, 0),
      place('loc_north', 'the North', under('loc_reach'), 0),
      place('loc_south', 'the South', {}, 0),
    ]
    const MILL = place('loc_mill', 'the old mill', under('loc_north'))
    const renameMill = reply({ renames: [{ ref: 'loc_mill', name: 'Varn', sourceTurn: 't1' }] })

    it('renames freely to a name a place under another parent holds', () => {
      const { planned, renameClashes } = buildClassifierActions(
        renameMill,
        deps([...PARENTS, MILL, place('loc_varn', 'Varn', under('loc_south'), 2)]),
      )
      expect(kindsOf(planned)).toEqual(['renameEntity'])
      expect(renameClashes).toEqual([])
    })

    it.each([
      ['under the same parent', MILL, under('loc_north')],
      ['top-level beside a top-level place', place('loc_mill', 'the old mill', {}), {}],
      [
        'unplaced, against a placed holder',
        place('loc_mill', 'the old mill', UNPLACED),
        under('loc_south'),
      ],
      ['placed, against an unplaced holder', MILL, UNPLACED],
      ['placed, against a holder whose parent names no place', MILL, under('loc_gone')],
    ])('clashes with a namesake %s', (_label, renamed, holderState) => {
      const { renameClashes } = buildClassifierActions(
        renameMill,
        deps([...PARENTS, renamed, place('loc_varn', 'Varn', holderState, 2)]),
      )
      expect(renameClashes).toEqual([
        { ref: 'loc_mill', name: 'Varn', partnerId: 'loc_varn', flagged: true },
      ])
    })

    // A reply that moves the place too is judged where the reply leaves it.
    it.each([
      ['clashes once moved beside', 'loc_south', 1],
      ['renames freely once moved away from', 'loc_north', 0],
    ])('%s a namesake under %s', (_label, holderParent, clashes) => {
      const { renameClashes } = buildClassifierActions(
        reply({
          placements: [{ ref: 'loc_mill', parent: 'loc_south', sourceTurn: 't1' }],
          renames: [{ ref: 'loc_mill', name: 'Varn', sourceTurn: 't3' }],
        }),
        deps([...PARENTS, MILL, place('loc_varn', 'Varn', under(holderParent), 2)]),
      )
      expect(renameClashes).toHaveLength(clashes)
    })

    it("takes the oldest holder the rule pairs, past an older one it doesn't", () => {
      const { renameClashes } = buildClassifierActions(
        renameMill,
        deps([
          ...PARENTS,
          MILL,
          place('loc_varn_south', 'Varn', under('loc_south'), 0),
          place('loc_varn_north', 'Varn', under('loc_north'), 3),
        ]),
      )
      expect(renameClashes.map((c) => c.partnerId)).toEqual(['loc_varn_north'])
    })

    const newVarn = (parent: string): ClassifierPlacesExtraction => ({
      ...renameMill,
      newPlaces: [
        {
          handle: 'new:varn',
          name: 'Varn',
          description: 'x',
          keywords: [],
          parent,
          sourceTurn: 't1',
        } as NewPlace,
      ],
    })

    it.each([
      ['plans a plain rename', 'loc_south', ['createEntity', 'renameEntity']],
      ['clashes', 'loc_north', ['createEntity', 'appendEntityKeywords', 'raiseCollisionFlag']],
    ])("%s beside this reply's own create of the name under %s", (_label, parent, kinds) => {
      const { planned } = buildClassifierActions(newVarn(parent), {
        ...base,
        entities: [...PARENTS, MILL],
        newId: () => 'loc_new1',
      } as never)
      expect(kindsOf(planned)).toEqual(kinds)
    })

    // The rename lands after the create's placement, so the holder sits where this reply put it.
    it('compares a holder this reply placed by where it put it', () => {
      const { planned } = buildClassifierActions(newVarn('loc_south'), {
        ...base,
        entities: [...PARENTS, MILL, place('loc_varn', 'Varn', UNPLACED, 2)],
      } as never)
      expect(kindsOf(planned)).toEqual(['placeLocation', 'renameEntity'])
    })
  })

  it("clashes with a name this reply's own create or earlier rename holds", () => {
    const { renameClashes } = buildClassifierActions(
      reply({
        newCharacters: [
          { handle: 'new:mira', name: 'Mira', description: 'x', keywords: [], sourceTurn: 't1' },
        ],
        renames: [
          { ref: 'char_stranger', name: 'Mira', sourceTurn: 't2' },
          { ref: 'char_kael', name: 'Corvin', sourceTurn: 't2' },
          { ref: 'char_third', name: 'corvin', sourceTurn: 't3' },
        ],
      }),
      deps([STRANGER, KAEL, row('char_third', 'character', 'the third man')], {
        decisions: new Map([['new:mira', { kind: 'create', flag: null }]]),
        newId: () => 'char_new1',
      }),
    )
    expect(renameClashes).toEqual([
      { ref: 'char_stranger', name: 'Mira', partnerId: 'char_new1', flagged: true },
      { ref: 'char_third', name: 'corvin', partnerId: 'char_kael', flagged: true },
    ])
  })

  it("applies a row's renames in source-turn order, so the latest prose names it", () => {
    const { planned } = buildClassifierActions(
      reply({
        renames: [
          { ref: 'char_stranger', name: 'Corvin Vale', sourceTurn: 't3' },
          { ref: 'char_stranger', name: 'Corvin', sourceTurn: 't1' },
        ],
      }),
      deps([STRANGER]),
    )
    expect(planned.map((p) => payloadOf<{ name: string }>(p).name)).toEqual([
      'Corvin',
      'Corvin Vale',
    ])
  })

  it("keeps the old name as the row's keyword for the rest of the reply", () => {
    const { planned } = buildClassifierActions(
      reply({
        renames: [{ ref: 'char_stranger', name: 'Corvin Vale', sourceTurn: 't1' }],
        aliases: [{ ref: 'char_stranger', terms: ['The Hooded Stranger'], sourceTurn: 't2' }],
      }),
      deps([STRANGER]),
    )
    expect(kindsOf(planned)).toEqual(['renameEntity'])
  })

  it('drops and reports a rename of a row the prompt never listed', () => {
    const { planned, unseenRefs } = buildClassifierActions(
      reply({
        newCharacters: [
          { handle: 'new:mira', name: 'Mira', description: 'x', keywords: [], sourceTurn: 't1' },
        ],
        renames: [
          { ref: 'c9', name: 'Kael', sourceTurn: 't1' },
          { ref: 'new:mira', name: 'Mirabel', sourceTurn: 't1' },
        ],
      }),
      deps([STRANGER], { decisions: new Map([['new:mira', { kind: 'create', flag: null }]]) }),
    )
    expect(kindsOf(planned)).toEqual(['createEntity'])
    expect(unseenRefs).toEqual([
      { list: 'renames', ref: 'c9' },
      { list: 'renames', ref: 'new:mira' },
    ])
  })

  it('raises one flag per row in a reply, however many taken names it meets', () => {
    const { planned, renameClashes } = buildClassifierActions(
      reply({
        renames: [
          { ref: 'char_stranger', name: 'Kael', sourceTurn: 't1' },
          { ref: 'char_stranger', name: 'Mira', sourceTurn: 't2' },
        ],
      }),
      deps([STRANGER, KAEL, row('char_mira', 'character', 'Mira')]),
    )
    expect(kindsOf(planned)).toEqual([
      'appendEntityKeywords',
      'raiseCollisionFlag',
      'appendEntityKeywords',
    ])
    expect(renameClashes.map((c) => c.flagged)).toEqual([true, false])
  })

  // A clash that writes nothing takes no anchor, so it never counts as a window-head fallback.
  it('counts no fallback for a clash that writes nothing', () => {
    const settled = row('char_stranger', 'character', 'the hooded stranger', {
      keywords: ['Kael'],
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_kael',
      nameCollisionReason: 'name-taken',
    })
    const { planned, renameClashes, fellBackCount } = buildClassifierActions(
      reply({ renames: [{ ref: 'char_stranger', name: 'Kael' }] }),
      deps([settled, KAEL]),
    )
    expect(planned).toEqual([])
    expect(renameClashes).toEqual([
      { ref: 'char_stranger', name: 'Kael', partnerId: 'char_kael', flagged: false },
    ])
    expect(fellBackCount).toBe(0)
  })
})

// classifier.md → What the classifier writes → Where a place sits; data-model.md → LocationState
// shape: a machine writer walks a placement first and drops a loop.
describe('placements', () => {
  const place = (id: string, parent: string | null, over: Record<string, unknown> = {}) =>
    ({
      id,
      branchId: 'branch_1',
      kind: 'location',
      name: id,
      description: 'x',
      status: 'active',
      keywords: [],
      createdAt: 1,
      state: { parent_location_id: parent },
      ...over,
    }) as unknown as Entity
  const unplaced = (id: string) =>
    place(id, null, { state: { parent_location_id: null, unplaced: true } })
  const deps = (entities: Entity[]) => ({ ...base, entities }) as never
  const REACH = place('loc_reach', null)
  const VARN = unplaced('loc_varn')
  const KAEL = {
    id: 'char_kael',
    kind: 'character',
    name: 'Kael',
    status: 'active',
    keywords: [],
  } as unknown as Entity
  const placementsOf = (planned: readonly PlannedWrite[]) =>
    planned.map((p) => payloadOf<{ id: string; placement: unknown }>(p))

  it('places an unplaced place under the parent the turns give, anchored and dated on its turn', () => {
    const { planned } = buildClassifierActions(
      reply({ placements: [{ ref: 'loc_varn', parent: 'loc_reach', sourceTurn: 't2' }] }),
      deps([REACH, VARN]),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'placeLocation',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'loc_varn',
            placement: { kind: 'under', parentId: 'loc_reach' },
            proseEntryId: 'e2',
          },
        },
        entryId: 'e2',
      },
    ])
  })

  it('moves a placed place', () => {
    const { planned } = buildClassifierActions(
      reply({ placements: [{ ref: 'loc_inn', parent: 'loc_reach', sourceTurn: 't1' }] }),
      deps([REACH, place('loc_town', null), place('loc_inn', 'loc_town')]),
    )
    expect(placementsOf(planned)).toEqual([
      expect.objectContaining({
        id: 'loc_inn',
        placement: { kind: 'under', parentId: 'loc_reach' },
      }),
    ])
  })

  it.each(['top-level', ' Top-Level '])('marks an unplaced place %j top-level', (parent) => {
    const { planned } = buildClassifierActions(
      reply({ placements: [{ ref: 'loc_varn', parent, sourceTurn: 't1' }] }),
      deps([VARN]),
    )
    expect(placementsOf(planned)).toEqual([
      expect.objectContaining({ id: 'loc_varn', placement: { kind: 'top' } }),
    ])
  })

  it('marks top-level a place whose stored parent names no place', () => {
    const { planned } = buildClassifierActions(
      reply({ placements: [{ ref: 'loc_orphan', parent: 'top-level', sourceTurn: 't1' }] }),
      deps([place('loc_orphan', 'loc_gone')]),
    )
    expect(placementsOf(planned)).toEqual([
      expect.objectContaining({ id: 'loc_orphan', placement: { kind: 'top' } }),
    ])
  })

  it.each([
    ['a top-level place', place('loc_town', null), []],
    ['a place under a parent', place('loc_inn', 'loc_town'), [place('loc_town', null)]],
  ])('drops a top-level mark for %s', (_label, target, others) => {
    const { planned, droppedPlacements } = buildClassifierActions(
      reply({ placements: [{ ref: target.id, parent: 'top-level', sourceTurn: 't1' }] }),
      deps([target, ...others]),
    )
    expect(planned).toEqual([])
    expect(droppedPlacements).toEqual([{ ref: target.id, cause: 'not-unplaced' }])
  })

  it.each([
    [
      'would close a loop',
      [place('loc_town', null), place('loc_inn', 'loc_town')],
      'loc_town',
      'loc_inn',
      'cycle',
    ],
    ['is itself', [place('loc_town', null)], 'loc_town', 'loc_town', 'cycle'],
    [
      'is retired',
      [VARN, place('loc_ford', null, { status: 'retired' })],
      'loc_varn',
      'loc_ford',
      'retired',
    ],
    [
      'sits on a broken chain',
      [VARN, place('loc_a', 'loc_b'), place('loc_b', 'loc_a')],
      'loc_varn',
      'loc_a',
      'chain-broken',
    ],
  ] as const)('drops a placement whose parent %s', (_label, entities, ref, parent, cause) => {
    const { planned, droppedPlacements } = buildClassifierActions(
      reply({ placements: [{ ref, parent, sourceTurn: 't1' }] }),
      deps([...entities]),
    )
    expect(planned).toEqual([])
    expect(droppedPlacements).toEqual([{ ref, cause }])
  })

  it('walks the placements this reply made before it', () => {
    const { planned, droppedPlacements } = buildClassifierActions(
      reply({
        placements: [
          { ref: 'loc_a', parent: 'loc_b', sourceTurn: 't1' },
          { ref: 'loc_b', parent: 'loc_a', sourceTurn: 't2' },
        ],
      }),
      deps([unplaced('loc_a'), unplaced('loc_b')]),
    )
    expect(placementsOf(planned)).toEqual([expect.objectContaining({ id: 'loc_a' })])
    expect(droppedPlacements).toEqual([{ ref: 'loc_b', cause: 'cycle' }])
  })

  it('plans nothing for a place already under that parent', () => {
    const { planned, droppedPlacements } = buildClassifierActions(
      reply({ placements: [{ ref: 'loc_inn', parent: 'loc_town', sourceTurn: 't1' }] }),
      deps([place('loc_town', null), place('loc_inn', 'loc_town')]),
    )
    expect(planned).toEqual([])
    expect(droppedPlacements).toEqual([])
  })

  // The schema's parent is an ID from Places or top-level: a new place is placed by its own create.
  it("reports a new place's handle as a placement's parent as unresolved", () => {
    const places: ClassifierPlacesExtraction = {
      ...reply({ placements: [{ ref: 'loc_varn', parent: 'new:reach', sourceTurn: 't2' }] }),
      newPlaces: [
        {
          handle: 'new:reach',
          name: 'the Eastern Reach',
          description: 'x',
          keywords: [],
          sourceTurn: 't1',
        } as NewPlace,
      ],
    }
    const { planned, unresolvedRefs } = buildClassifierActions(places, {
      ...base,
      entities: [VARN],
      newId: () => 'loc_new1',
    } as never)
    expect(kindsOf(planned)).toEqual(['createEntity'])
    expect(unresolvedRefs).toEqual(['new:reach'])
  })

  it('reports a parent naming no place, and a target that is no place, as unresolved', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      reply({
        placements: [
          { ref: 'loc_varn', parent: 'l9', sourceTurn: 't1' },
          { ref: 'char_kael', parent: 'loc_reach', sourceTurn: 't1' },
        ],
      }),
      deps([REACH, VARN, KAEL]),
    )
    expect(planned).toEqual([])
    expect(unresolvedRefs).toEqual(['l9', 'char_kael'])
  })

  it('drops and reports a placement of a place the prompt never listed', () => {
    const { planned, unseenRefs } = buildClassifierActions(
      reply({ placements: [{ ref: 'l7', parent: 'loc_reach', sourceTurn: 't1' }] }),
      deps([REACH]),
    )
    expect(planned).toEqual([])
    expect(unseenRefs).toEqual([{ list: 'placements', ref: 'l7' }])
  })

  it("applies a place's placements in source-turn order, so the latest prose places it", () => {
    const { planned } = buildClassifierActions(
      reply({
        placements: [
          { ref: 'loc_varn', parent: 'loc_reach', sourceTurn: 't3' },
          { ref: 'loc_varn', parent: 'loc_ford', sourceTurn: 't1' },
        ],
      }),
      deps([REACH, place('loc_ford', null), VARN]),
    )
    expect(planned.map((p) => [payloadOf<{ placement: unknown }>(p).placement, p.entryId])).toEqual(
      [
        [{ kind: 'under', parentId: 'loc_ford' }, 'e1'],
        [{ kind: 'under', parentId: 'loc_reach' }, 'e3'],
      ],
    )
  })

  it('drops a top-level mark for a place this reply already placed', () => {
    const { planned, droppedPlacements } = buildClassifierActions(
      reply({
        placements: [
          { ref: 'loc_varn', parent: 'loc_reach', sourceTurn: 't1' },
          { ref: 'loc_varn', parent: 'top-level', sourceTurn: 't2' },
        ],
      }),
      deps([REACH, VARN]),
    )
    expect(placementsOf(planned)).toEqual([
      expect.objectContaining({ placement: { kind: 'under', parentId: 'loc_reach' } }),
    ])
    expect(droppedPlacements).toEqual([{ ref: 'loc_varn', cause: 'not-unplaced' }])
  })
})

// classifier.md → Factions: a listed faction's standing, emitted only when the turns change it.
describe('standings', () => {
  const faction = (id: string, standing?: string) =>
    ({
      id,
      branchId: 'branch_1',
      kind: 'faction',
      name: id,
      description: 'x',
      status: 'active',
      keywords: [],
      state: standing === undefined ? {} : { standing },
    }) as unknown as Entity
  const deps = (entities: Entity[]) => ({ ...base, entities }) as never

  // classifier.md → Factions → Memberships' rule: a retired faction's standing is a misreading.
  it('drops and reports a standing for a faction retired before the reply', () => {
    const retired = { ...(faction('fact_watch', 'wary allies') as object), status: 'retired' }
    const { planned, droppedStandings } = buildClassifierActions(
      reply({ standings: [{ ref: 'fact_watch', standing: 'outlawed', sourceTurn: 't1' }] }),
      deps([retired as Entity]),
    )
    expect(planned).toEqual([])
    expect(droppedStandings).toEqual([{ faction: 'fact_watch', cause: 'retired-faction' }])
  })

  it.each([
    ['before', 't1', 't2'],
    ['after', 't3', 't2'],
  ])(
    'keeps a standing from %s the turn the reply retires its faction',
    (_label, standingTurn, retireTurn) => {
      const { planned, droppedStandings } = buildClassifierActions(
        reply({
          standings: [{ ref: 'fact_watch', standing: 'outlawed', sourceTurn: standingTurn }],
          statusFlips: [{ ref: 'fact_watch', to: 'retired', sourceTurn: retireTurn }],
        }),
        deps([faction('fact_watch', 'wary allies')]),
      )
      expect(kindsOf(planned).sort()).toEqual(['retireEntity', 'setFactionStanding'])
      expect(droppedStandings).toEqual([])
    },
  )

  it("writes a listed faction's new standing, trimmed, anchored and dated on its turn", () => {
    const { planned } = buildClassifierActions(
      reply({ standings: [{ ref: 'fact_watch', standing: ' outlawed ', sourceTurn: 't2' }] }),
      deps([faction('fact_watch', 'wary allies')]),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'setFactionStanding',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            id: 'fact_watch',
            standing: 'outlawed',
            proseEntryId: 'e2',
          },
        },
        entryId: 'e2',
      },
    ])
  })

  it('cuts a long standing at a clause, as the handler stores it', () => {
    const { planned } = buildClassifierActions(
      reply({
        standings: [
          {
            ref: 'fact_watch',
            standing: `${'a'.repeat(300)}, ${'b'.repeat(300)}`,
            sourceTurn: 't1',
          },
        ],
      }),
      deps([faction('fact_watch')]),
    )
    expect(payloadOf<{ standing: string }>(planned[0]).standing).toBe('a'.repeat(300))
  })

  // The handler compares what it would store: a long restatement of a cut standing writes nothing.
  it('plans nothing for a standing whose cut is the one stored', () => {
    const { planned } = buildClassifierActions(
      reply({
        standings: [
          {
            ref: 'fact_watch',
            standing: `${'a'.repeat(300)}, ${'b'.repeat(300)}`,
            sourceTurn: 't1',
          },
        ],
      }),
      deps([faction('fact_watch', 'a'.repeat(300))]),
    )
    expect(planned).toEqual([])
  })

  // classifier-context.ts shows a standing on one line, so the pass restates it so.
  it('plans nothing for a standing the prompt showed on one line', () => {
    const { planned } = buildClassifierActions(
      reply({ standings: [{ ref: 'fact_watch', standing: 'wary allies', sourceTurn: 't1' }] }),
      deps([faction('fact_watch', 'wary\n  allies')]),
    )
    expect(planned).toEqual([])
  })

  it("clamps a standing to the faction state's 500 characters, never splitting a pair", () => {
    const { planned } = buildClassifierActions(
      reply({
        standings: [{ ref: 'fact_watch', standing: `${'s'.repeat(499)}😀tail`, sourceTurn: 't1' }],
      }),
      deps([faction('fact_watch')]),
    )
    expect(payloadOf<{ standing: string }>(planned[0]).standing).toBe('s'.repeat(499))
  })

  it.each([['  '], ['wary allies']])('plans nothing for the standing %j', (standing) => {
    const { planned } = buildClassifierActions(
      reply({ standings: [{ ref: 'fact_watch', standing, sourceTurn: 't1' }] }),
      deps([faction('fact_watch', 'wary allies')]),
    )
    expect(planned).toEqual([])
  })

  it("applies a faction's standings in source-turn order", () => {
    const { planned } = buildClassifierActions(
      reply({
        standings: [
          { ref: 'fact_watch', standing: 'at peace', sourceTurn: 't3' },
          { ref: 'fact_watch', standing: 'at war', sourceTurn: 't1' },
        ],
      }),
      deps([faction('fact_watch')]),
    )
    expect(planned.map((p) => payloadOf<{ standing: string }>(p).standing)).toEqual([
      'at war',
      'at peace',
    ])
  })

  it('reports a standing for a row that is no faction, and one the prompt never listed', () => {
    const kael = {
      id: 'char_kael',
      kind: 'character',
      name: 'Kael',
      status: 'active',
      keywords: [],
    } as unknown as Entity
    const { planned, unresolvedRefs, unseenRefs } = buildClassifierActions(
      reply({
        standings: [
          { ref: 'char_kael', standing: 'feared', sourceTurn: 't1' },
          { ref: 'f9', standing: 'feared', sourceTurn: 't1' },
        ],
      }),
      deps([kael]),
    )
    expect(planned).toEqual([])
    expect(unresolvedRefs).toEqual(['char_kael'])
    expect(unseenRefs).toEqual([{ list: 'standings', ref: 'f9' }])
  })

  it('plans one write for a standing the reply repeats', () => {
    const { planned } = buildClassifierActions(
      reply({
        standings: [
          { ref: 'fact_watch', standing: 'at war', sourceTurn: 't1' },
          { ref: 'fact_watch', standing: ' at war ', sourceTurn: 't2' },
        ],
      }),
      deps([faction('fact_watch', 'wary allies')]),
    )
    expect(planned.map((p) => payloadOf<{ standing: string }>(p).standing)).toEqual(['at war'])
  })
})

// classifier.md → Threads and → What the classifier writes → Happenings.
describe('plot writes', () => {
  const deps = (over: Record<string, unknown> = {}) => {
    let n = 0
    return { ...base, newId: (kind: string) => `${kind}_new${++n}`, ...over } as never
  }
  const thread = (id: string, status: string) =>
    ({ id, branchId: 'branch_1', title: id, status, triggeredAtEntryId: null }) as never
  const character = (id: string) => ({
    id,
    kind: 'character',
    name: id,
    status: 'active',
    keywords: [],
  })

  it("writes a happening's category and a catalog icon, and none for a blank or unknown one", () => {
    const { planned, unknownIcons } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            category: ' omen ',
            icon: ' Eye ',
            sourceTurn: 't1',
            involvements: [],
            awareness: [],
          },
          {
            title: 'B',
            category: '  ',
            icon: 'rocket',
            sourceTurn: 't1',
            involvements: [],
            awareness: [],
          },
          { title: 'C', sourceTurn: 't1', involvements: [], awareness: [] },
          { title: 'D', icon: '  ', sourceTurn: 't1', involvements: [], awareness: [] },
        ],
      }),
      deps(),
    )
    expect(
      planned.map((p) => payloadOf<{ entry: { category: unknown; icon: unknown } }>(p).entry),
    ).toEqual([
      expect.objectContaining({ category: 'omen', icon: 'eye' }),
      expect.objectContaining({ category: null, icon: null }),
      expect.objectContaining({ category: null, icon: null }),
      expect.objectContaining({ category: null, icon: null }),
    ])
    // An absent or blank icon is no claim on the catalog, so only B's is reported.
    expect(unknownIcons).toEqual([{ title: 'B', icon: 'rocket' }])
  })

  // cadence.md → User edits and classifier writes: a write to an existing row names its prose.
  it("dates a happening's own awareness by the happening's turn", () => {
    const { planned } = buildClassifierActions(
      reply({
        happenings: [
          {
            title: 'A',
            sourceTurn: 't2',
            involvements: [],
            awareness: [{ ref: 'char_a', source: 'told', severity: 0.5, learnedAtTurn: 't3' }],
          },
          {
            title: 'B',
            involvements: [],
            awareness: [{ ref: 'char_b', source: 'saw it', severity: 0.5 }],
          },
        ],
      }),
      deps(),
    )
    expect(
      planned
        .filter((p) => p.action.kind === 'upsertHappeningAwareness')
        .map((p) => [payloadOf<{ proseEntryId?: string }>(p).proseEntryId, p.entryId]),
    ).toEqual([
      ['e2', 'e3'],
      ['e1', 'e3'],
    ])
  })

  it('creates a thread the turns set up, triggered and anchored on its turn', () => {
    const { planned } = buildClassifierActions(
      reply({
        newThreads: [
          {
            title: ' Find the ferryman ',
            description: 'He knows the way.',
            category: 'quest',
            icon: 'map',
            status: 'active',
            sourceTurn: 't2',
          },
        ],
      }),
      deps(),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'createThread',
          source: 'periodic_classifier',
          payload: {
            entry: {
              id: 'thr_new1',
              branchId: 'branch_1',
              title: 'Find the ferryman',
              description: 'He knows the way.',
              category: 'quest',
              icon: 'map',
              status: 'active',
              injectionMode: 'auto',
              triggeredAtEntryId: 'e2',
              resolvedAtEntryId: null,
              embeddingStale: 1,
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
            },
          },
        },
        entryId: 'e2',
      },
    ])
  })

  it("clamps a new thread's title and description as a happening's, and drops an unknown icon", () => {
    const { planned, unknownIcons } = buildClassifierActions(
      reply({
        newThreads: [
          {
            title: 'T'.repeat(130),
            description: 'D'.repeat(1300),
            icon: 'rocket',
            status: 'pending',
            sourceTurn: 't1',
          },
          { title: '  ', description: 'x', status: 'active', sourceTurn: 't1' },
        ],
      }),
      deps(),
    )
    expect(planned).toHaveLength(1)
    const { entry } = payloadOf<{
      entry: { title: string; description: string; icon: string | null }
    }>(planned[0])
    expect(entry.title).toBe('T'.repeat(120))
    expect(entry.description).toBe('D'.repeat(1200))
    expect(entry.icon).toBeNull()
    expect(unknownIcons).toEqual([{ title: 'T'.repeat(130), icon: 'rocket' }])
  })

  describe('a thread these turns both open and close', () => {
    const openAndClose = (over: Record<string, unknown>) =>
      buildClassifierActions(
        reply({
          newThreads: [{ title: 'Cross the river', description: 'x', status: 'resolved', ...over }],
        }),
        deps(),
      )
    const writes = (planned: readonly PlannedWrite[]) =>
      planned.map((p) => {
        const payload = payloadOf<{
          entry?: { status: string; triggeredAtEntryId: string; resolvedAtEntryId: string | null }
        }>(p)
        return [
          p.action.kind,
          payload.entry === undefined
            ? payload
            : {
                status: payload.entry.status,
                triggeredAtEntryId: payload.entry.triggeredAtEntryId,
                resolvedAtEntryId: payload.entry.resolvedAtEntryId,
              },
          p.entryId,
        ]
      })
    const opened = (at: string) => [
      'createThread',
      { status: 'active', triggeredAtEntryId: at, resolvedAtEntryId: null },
      at,
    ]
    const closed = (status: string, at: string, prose = at) => [
      'setThreadStatus',
      {
        branchId: 'branch_1',
        id: 'thr_new1',
        status,
        resolvedAtEntryId: at,
        proseEntryId: prose,
      },
      at,
    ]

    // Two writes, each kept by its own turn: reversing the closing turn alone reopens it.
    it.each([['resolved'], ['failed']])(
      'opens it active at its turn and moves it to %s at the closing turn',
      (status) => {
        const { planned, fellBackCount } = openAndClose({
          status,
          sourceTurn: 't1',
          resolvedAtTurn: 't3',
        })
        expect(writes(planned)).toEqual([opened('e1'), closed(status, 'e3')])
        expect(fellBackCount).toBe(0)
      },
    )

    it('closes it at its own turn when no closing turn is named', () => {
      const { planned } = openAndClose({ sourceTurn: 't2' })
      expect(writes(planned)).toEqual([opened('e2'), closed('resolved', 'e2')])
    })

    it('closes it at its own turn, and reports the label, when the closing turn names none', () => {
      const { planned, unresolvedRefs, fellBackCount } = openAndClose({
        sourceTurn: 't2',
        resolvedAtTurn: 't9',
      })
      expect(writes(planned)).toEqual([opened('e2'), closed('resolved', 'e2')])
      expect(unresolvedRefs).toEqual(['t9'])
      expect(fellBackCount).toBe(0)
    })

    it('never closes it before it opens', () => {
      const { planned } = openAndClose({ sourceTurn: 't3', resolvedAtTurn: 't1' })
      expect(writes(planned)).toEqual([opened('e3'), closed('resolved', 'e3')])
    })

    // An unattributed thread opens at the window head; an earlier closing turn can't precede it.
    it('closes an unattributed thread at the window head it opened on', () => {
      const { planned } = openAndClose({ resolvedAtTurn: 't2' })
      expect(writes(planned)).toEqual([opened('e3'), closed('resolved', 'e3', 'e1')])
    })

    it.each([['active'], ['pending']])('ignores a closing turn on a %s thread', (status) => {
      const { planned } = openAndClose({ status, sourceTurn: 't1', resolvedAtTurn: 't3' })
      expect(writes(planned)).toEqual([
        ['createThread', { status, triggeredAtEntryId: 'e1', resolvedAtEntryId: null }, 'e1'],
      ])
    })
  })

  it("moves a listed thread's status in source-turn order, resolving it at the change's turn", () => {
    const { planned } = buildClassifierActions(
      reply({
        threadStatuses: [
          { thread: 'thr_a', status: 'resolved', sourceTurn: 't3' },
          { thread: 'thr_b', status: 'active', sourceTurn: 't1' },
          { thread: 'thr_c', status: 'active', sourceTurn: 't1' },
        ],
      }),
      deps({
        threads: [thread('thr_a', 'active'), thread('thr_b', 'failed'), thread('thr_c', 'active')],
      }),
    )
    expect(planned.map((p) => [p.action.kind, p.action.payload, p.entryId])).toEqual([
      [
        'setThreadStatus',
        { branchId: 'branch_1', id: 'thr_b', status: 'active', proseEntryId: 'e1' },
        'e1',
      ],
      [
        'setThreadStatus',
        {
          branchId: 'branch_1',
          id: 'thr_a',
          status: 'resolved',
          resolvedAtEntryId: 'e3',
          proseEntryId: 'e3',
        },
        'e3',
      ],
    ])
  })

  it("judges each status change against the status the reply's earlier ones left", () => {
    const { planned } = buildClassifierActions(
      reply({
        threadStatuses: [
          { thread: 'thr_a', status: 'resolved', sourceTurn: 't1' },
          { thread: 'thr_a', status: 'active', sourceTurn: 't2' },
          { thread: 'thr_b', status: 'resolved', sourceTurn: 't1' },
          { thread: 'thr_b', status: 'resolved', sourceTurn: 't2' },
        ],
      }),
      deps({ threads: [thread('thr_a', 'active'), thread('thr_b', 'active')] }),
    )
    expect(
      planned.map((p) => {
        const { id, status, resolvedAtEntryId } = payloadOf<{
          id: string
          status: string
          resolvedAtEntryId?: string
        }>(p)
        return [id, status, resolvedAtEntryId, p.entryId]
      }),
    ).toEqual([
      ['thr_a', 'resolved', 'e1', 'e1'],
      ['thr_b', 'resolved', 'e1', 'e1'],
      ['thr_a', 'active', undefined, 'e2'],
    ])
  })

  it("trims a new thread's category, and writes a blank one as none", () => {
    const { planned } = buildClassifierActions(
      reply({
        newThreads: [
          { title: 'A', description: 'x', category: ' quest ', status: 'active', sourceTurn: 't1' },
          { title: 'B', description: 'x', category: '  ', status: 'active', sourceTurn: 't1' },
        ],
      }),
      deps(),
    )
    expect(
      planned.map((p) => payloadOf<{ entry: { category: unknown } }>(p).entry.category),
    ).toEqual(['quest', null])
  })

  it('drops and reports a status for a thread the prompt never listed', () => {
    const { planned, unseenRefs } = buildClassifierActions(
      reply({ threadStatuses: [{ thread: 'th9', status: 'failed', sourceTurn: 't1' }] }),
      deps(),
    )
    expect(planned).toEqual([])
    expect(unseenRefs).toEqual([{ list: 'threadStatuses', ref: 'th9' }])
  })

  it('adds awareness of a listed happening, dated on its learning turn', () => {
    const { planned } = buildClassifierActions(
      reply({
        knownAwareness: [
          {
            happening: 'hap_fire',
            ref: 'char_a',
            source: ' told by Mira ',
            severity: 1.4,
            learnedAtTurn: 't2',
          },
        ],
      }),
      deps({ entities: [character('char_a')], happenings: [{ id: 'hap_fire' }] }),
    )
    expect(planned).toEqual([
      {
        action: {
          kind: 'upsertHappeningAwareness',
          source: 'periodic_classifier',
          payload: {
            branchId: 'branch_1',
            characterId: 'char_a',
            happeningId: 'hap_fire',
            learnedAtEntryId: 'e2',
            decayResistance: 1,
            source: 'told by Mira',
            proseEntryId: 'e2',
          },
        },
        entryId: 'e2',
      },
    ])
  })

  it('plans nothing for a stored pair or a repeat, and reports an unlisted happening', () => {
    const { planned, unseenRefs } = buildClassifierActions(
      reply({
        knownAwareness: [
          { happening: 'hap_fire', ref: 'char_a', source: 'x', severity: 0.5 },
          { happening: 'hap_fire', ref: 'char_b', source: 'x', severity: 0.5 },
          { happening: 'hap_fire', ref: 'char_b', source: 'y', severity: 0.9 },
          { happening: 'hp9', ref: 'char_a', source: 'x', severity: 0.5 },
        ],
      }),
      deps({
        entities: [character('char_a'), character('char_b')],
        happenings: [{ id: 'hap_fire' }],
        awareness: [{ characterId: 'char_a', happeningId: 'hap_fire' }],
      }),
    )
    expect(planned.map((p) => payloadOf<{ characterId: string; source: string }>(p))).toEqual([
      expect.objectContaining({ characterId: 'char_b', source: 'x' }),
    ])
    expect(unseenRefs).toEqual([{ list: 'knownAwareness', ref: 'hp9' }])
  })

  // The survival anchor falls back to the newest turn; the prose dates to the oldest.
  it('dates an unattributed learning by the oldest window turn, anchoring it on the head', () => {
    const { planned } = buildClassifierActions(
      reply({
        knownAwareness: [
          { happening: 'hap_fire', ref: 'char_a', source: 'x', severity: 0.5, learnedAtTurn: 't9' },
        ],
      }),
      deps({ entities: [character('char_a')], happenings: [{ id: 'hap_fire' }] }),
    )
    expect(
      planned.map((p) => {
        const { learnedAtEntryId, proseEntryId } = payloadOf<{
          learnedAtEntryId: string
          proseEntryId: string
        }>(p)
        return [learnedAtEntryId, proseEntryId, p.entryId]
      }),
    ).toEqual([['e3', 'e1', 'e3']])
  })

  it('reports an awareness ref that is no character', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      reply({
        knownAwareness: [{ happening: 'hap_fire', ref: 'loc_inn', source: 'x', severity: 0.5 }],
      }),
      deps({
        entities: [{ ...character('loc_inn'), kind: 'location' }],
        happenings: [{ id: 'hap_fire' }],
      }),
    )
    expect(planned).toEqual([])
    expect(unresolvedRefs).toEqual(['loc_inn'])
  })
})
