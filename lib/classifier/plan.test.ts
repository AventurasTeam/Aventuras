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
}

describe('buildClassifierActions', () => {
  it('anchors each fact to its own source turn', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [], awareness: [] },
          { title: 'B', sourceTurn: 't3', involvements: [], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    const anchors = planned.filter((p) => p.action.kind === 'createHappening').map((p) => p.entryId)
    expect(anchors).toEqual(['e1', 'e3'])
  })

  it('falls back to the window head for an unattributed fact and reports it', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      {
        happenings: [{ title: 'A', involvements: [], awareness: [] }],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned[0].entryId).toBe('e3')
    expect(fellBackCount).toBe(1)
  })

  it('gives involvements their parent anchor and awareness its own learning turn', () => {
    const { planned } = buildClassifierActions(
      {
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
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
    const awareness = planned.find((p) => p.action.kind === 'upsertHappeningAwareness')
    expect(involvement?.entryId).toBe('e1')
    expect(awareness?.entryId).toBe('e3')
  })

  it('stores blank free text as absent rather than an empty string', () => {
    const { planned } = buildClassifierActions(
      {
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
        relationships: [],
        statusFlips: [{ ref: 'char_kael', to: 'retired', reason: '\n', sourceTurn: 't2' }],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [
          {
            title: ' \n',
            involvements: [{ ref: 'char_a' }],
            awareness: [{ ref: 'char_b', source: 'saw it', severity: 0.5 }],
          },
          { title: 'B', sourceTurn: 't1', involvements: [], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned.map((p) => p.action.kind)).toEqual(['createHappening'])
    expect(payloadOf<{ entry: { title: string } }>(planned[0]).entry.title).toBe('B')
    expect(fellBackCount).toBe(0)
  })

  it('trims the whitespace around a happening title', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [{ title: '  The ford  ', sourceTurn: 't1', involvements: [], awareness: [] }],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(payloadOf<{ entry: { title: string } }>(planned[0]).entry.title).toBe('The ford')
  })

  it('clamps an out-of-range severity into [0, 1]', () => {
    const { planned } = buildClassifierActions(
      {
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
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      { ...base, entities: [entityRow('char_a'), entityRow('char_b')] },
    )
    const resistances = planned
      .filter((p) => p.action.kind === 'upsertHappeningAwareness')
      .map((p) => payloadOf<{ decayResistance: number }>(p).decayResistance)
    expect(resistances).toEqual([1, 0])
  })

  it('maps severity onto decay_resistance and stamps learned_at_entry_id', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [
          {
            title: 'A',
            sourceTurn: 't2',
            involvements: [],
            awareness: [{ ref: 'char_a', source: 'witnessed firsthand', severity: 0.9 }],
          },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(payloadOf<{ entry: { embeddingStale: number } }>(planned[0]).entry.embeddingStale).toBe(
      1,
    )
  })

  it('emits relationships as (subject, object, kind) for the action to normalize', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [],
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: 'sister', sourceTurn: 't1' },
        ],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [],
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: '   ', sourceTurn: 't1' },
        ],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned).toEqual([])
  })

  it('trims a relationship kind before writing it', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [],
        relationships: [
          { subject: 'char_kael', object: 'char_aria', kind: ' ally ', sourceTurn: 't1' },
        ],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'upsertCharacterRelationship',
      payload: { kind: 'ally' },
    })
  })

  it('writes a retirement only for the retired transition and carries the reason', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [],
        relationships: [],
        statusFlips: [
          { ref: 'char_kael', to: 'retired', reason: 'killed at the ford', sourceTurn: 't2' },
        ],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'A dragon.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'A dragon.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'The keeper.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          {
            handle: 'h1',
            name: 'Eldrin',
            description: 'The keeper.',
            keywords: [],
            sourceTurn: 't1',
          },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'nope' }], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned.filter((p) => p.action.kind === 'createHappeningInvolvement')).toHaveLength(0)
    expect(unresolvedRefs).toEqual(['nope'])
  })

  it('orders creates before the rows that reference them', () => {
    const decisions = new Map<string, ReconcileDecision>([['h1', { kind: 'create', flag: null }]])
    const { planned } = buildClassifierActions(
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          { handle: 'h1', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
        {
          happenings: [{ involvements: [], awareness: [], ...happening }] as never,
          relationships: [],
          statusFlips: [],
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
        {
          happenings: [
            {
              title: 'A',
              sourceTurn: 't1',
              involvements: [],
              awareness: [{ ref: 'loc_1', source: 's', severity: 0.5 }],
            },
          ],
          relationships: [],
          statusFlips: [],
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
        { ...base, entities },
      )
      expect(planned.filter((p) => p.action.kind === 'upsertHappeningAwareness')).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['loc_1'])
    })

    it('rejects a relationship whose object is not a character', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        {
          happenings: [],
          relationships: [{ subject: 'char_a', object: 'loc_1', kind: 'guards', sourceTurn: 't1' }],
          statusFlips: [],
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
        { ...base, entities },
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['loc_1'])
    })

    it('accepts a non-character involvement ref, which is polymorphic', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        {
          happenings: [
            { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'loc_1' }], awareness: [] },
          ],
          relationships: [],
          statusFlips: [],
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
        {
          happenings: [],
          relationships: [],
          statusFlips: [],
          newCharacters: [
            { handle: 'h9', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
        base,
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['h9'])
    })

    it('drops a blank-named character even when reconcile decided create', () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        {
          happenings: [],
          relationships: [],
          statusFlips: [],
          newCharacters: [
            { handle: 'h1', name: '  ', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
        {
          happenings: [],
          relationships: [],
          statusFlips: [],
          newCharacters: [
            { handle: 'h1', name: 'char_a', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
        {
          happenings: [],
          relationships: [],
          statusFlips: [],
          newCharacters: [
            { handle: 'h1', name: 'First', description: 'x', keywords: [], sourceTurn: 't1' },
            { handle: 'h1', name: 'Second', description: 'y', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
      {
        happenings: [],
        relationships: [{ subject: 'char_a', object: 'char_a', kind: 'rival', sourceTurn: 't1' }],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      base,
    )
    expect(planned).toHaveLength(0)
  })

  describe('status-flip monotonicity', () => {
    const flip = (ref: string, to: string, entities: never[]) =>
      buildClassifierActions(
        {
          happenings: [],
          relationships: [],
          statusFlips: [{ ref, to, sourceTurn: 't1' }] as never,
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
        { ...base, entities },
      )

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

    it('never revives a retired entity', () => {
      const { planned } = flip('char_r', 'active', [entityRow('char_r', 'retired')])
      expect(planned).toHaveLength(0)
    })

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
        {
          happenings: [],
          relationships: [],
          statusFlips: [
            { ref: 'char_a', to: 'retired', sourceTurn: 't1' },
            { ref: 'char_a', to: 'retired', sourceTurn: 't2' },
          ],
          newCharacters: [],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
        { ...base, entities: [entityRow('char_a')] },
      )
      expect(planned).toHaveLength(1)
    })

    it('retires an entity promoted earlier in the same reply', () => {
      const decisions = new Map<string, ReconcileDecision>([
        ['h1', { kind: 'promote', entityId: 'char_s', similarity: 0.9 }],
      ])
      const { planned } = buildClassifierActions(
        {
          happenings: [],
          relationships: [],
          statusFlips: [{ ref: 'char_s', to: 'retired', reason: 'fell', sourceTurn: 't2' }],
          newCharacters: [
            { handle: 'h1', name: 'char_s', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
        {
          happenings: [],
          relationships: [],
          statusFlips: [{ ref: 'h1', to: 'retired', reason: 'fell', sourceTurn: 't2' }],
          newCharacters: [
            { handle: 'h1', name: 'Eldrin', description: 'x', keywords: [], sourceTurn: 't1' },
          ],
          aliases: [],
          newFactions: [],
          memberships: [],
        },
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
  const candidate = (keywords: string[]) => ({
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [{ handle: 'new:k', name: 'Kael', description: 'A courier.', keywords }],
    aliases: [],
    newFactions: [],
    memberships: [],
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
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
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
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
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
        aliases: [],
        newFactions: [],
        memberships: [],
      },
      {
        ...base,
        entities: [entityRow('char_kael', 'staged', 'Kael')] as never[],
        decisions: new Map<string, ReconcileDecision>([
          ['new:k1', { kind: 'promote', entityId: 'char_kael', similarity: 0.9 }],
          ['new:k2', { kind: 'promote', entityId: 'char_kael', similarity: 0.9 }],
        ]),
      },
    )
    expect(planned.map((p) => p.action.kind)).toEqual([
      'promoteStagedEntity',
      'appendEntityKeywords',
      'promoteStagedEntity',
      'appendEntityKeywords',
    ])
    expect(payloadOf<{ keywords: string[] }>(planned[3]).keywords).toEqual(['the innkeeper'])
  })

  // Two guarded writes: a promotion the user pre-empted no-ops while the aliases still land.
  it('promotes and appends keywords as separate writes', () => {
    const { planned } = buildClassifierActions(
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          {
            handle: 'new:k',
            name: 'Kael',
            description: 'A courier.',
            keywords: ['the grey wolf'],
            sourceTurn: 't1',
          },
        ],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
  const reply = (
    aliases: ClassifierExtraction['aliases'],
    newCharacters: ClassifierExtraction['newCharacters'] = [],
  ): ClassifierExtraction => ({
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters,
    newFactions: [],
    memberships: [],
    aliases,
  })
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
      reply([{ ref: 'char_kael', terms: ['the Grey Wolf', 'The Courier'], sourceTurn: 't2' }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([appendOf('char_kael', ['the Grey Wolf'], 'e2')])
    expect(unresolvedRefs).toEqual([])
  })

  it('appends to a listed entity of any kind', () => {
    const ford = nonCharacterRow('loc_ford', 'location')
    const { planned } = buildClassifierActions(
      reply([{ ref: 'loc_ford', terms: ['the crossing'], sourceTurn: 't1' }]),
      { ...base, entities: [ford] },
    )
    expect(planned).toEqual([appendOf('loc_ford', ['the crossing'], 'e1')])
  })

  // canon: the ref names a listed entity. A handle's row is this reply's create.
  it('reports a newCharacters handle as unresolved and writes nothing for it', () => {
    const { planned, unresolvedRefs } = buildClassifierActions(
      reply(
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
      reply(
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
      reply([{ ref: 'c9', terms: ['the ferryman'], sourceTurn: 't1' }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([])
    expect(unresolvedRefs).toEqual(['c9'])
  })

  // No write means no anchor: an unattributed entry that adds nothing counts no fallback.
  it('plans nothing, and resolves no anchor, when every term is held or blank', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      reply([{ ref: 'char_kael', terms: ['THE COURIER ', '  '] }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([])
    expect(fellBackCount).toBe(0)
  })

  it('dates an unattributed alias by the oldest turn and anchors it at the head', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      reply([{ ref: 'char_kael', terms: ['the rider'] }]),
      { ...base, entities: [kael] },
    )
    expect(planned).toEqual([appendOf('char_kael', ['the rider'], 'e1', 'e3')])
    expect(fellBackCount).toBe(1)
  })

  it('de-duplicates two entries for one entity against each other', () => {
    const { planned } = buildClassifierActions(
      reply([
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
      reply(
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
      {
        happenings: [],
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
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      ['promoteStagedEntity', 'e2', 'e2'],
      ['retireEntity', 'e1', 'e1'],
    ])
  })

  // The survival anchor falls back to the newest turn; precedence must not date the
  // prose that late, or a user edit made after its real source would lose.
  it('dates an unattributed fact by the oldest window turn, keeping the head as its anchor', () => {
    const { planned, fellBackCount } = buildClassifierActions(
      {
        happenings: [],
        relationships: [{ subject: 'char_kael', object: 'char_aria', kind: 'sister' }],
        statusFlips: [{ ref: 'char_a', to: 'retired' }],
        newCharacters: [{ handle: 'h1', name: 'P', description: 'x', keywords: ['the keeper'] }],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
  const character = (name: string, description: string) => ({
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [{ handle: 'h1', name, description, keywords: [], sourceTurn: 't1' }],
    aliases: [],
    newFactions: [],
    memberships: [],
  })
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
      {
        happenings: [
          {
            title: 'T'.repeat(119) + 'X' + 'Y'.repeat(80),
            description: 'D'.repeat(1199) + 'X' + 'Z'.repeat(500),
            sourceTurn: 't1',
            involvements: [],
            awareness: [],
          },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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
      {
        happenings: [{ title: 'A', sourceTurn: 't1', involvements: [], awareness: [] }],
        relationships: [],
        statusFlips: [],
        newCharacters: [],
        aliases: [],
        newFactions: [],
        memberships: [],
      },
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

  const reply = (
    newPlaces: NewPlace[],
    over: Partial<ClassifierPlacesExtraction> = {},
  ): ClassifierPlacesExtraction => ({
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    aliases: [],
    newFactions: [],
    memberships: [],
    newPlaces,
    ...over,
  })

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
    state: { parent_location_id: string | null }
  } & Record<string, unknown>
  const createdPlaces = (planned: readonly PlannedWrite[]) =>
    planned
      .filter((p) => p.action.kind === 'createEntity')
      .map((p) => payloadOf<{ entry: Created }>(p).entry)
      .filter((e) => e.kind === 'location')
  const parentOf = (planned: readonly PlannedWrite[], name: string) =>
    createdPlaces(planned).find((e) => e.name === name)?.state.parent_location_id

  const TOWN = placeRow('loc_town', 'Varn', null)

  it('creates an active, auto place from the prose, stale, anchored on its turn', () => {
    const { planned, handleMap, parentDrops } = buildClassifierActions(
      reply([
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
      reply([
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

  it('puts a place whose parent the turns do not give at the root, unlogged', () => {
    const { planned, parentDrops } = buildClassifierActions(
      reply([newPlace('new:a', 'Ash')]),
      deps([]),
    )
    expect(parentOf(planned, 'Ash')).toBeNull()
    expect(parentDrops).toEqual([])
  })

  it('resolves parents top-down: a child listed before its parent hangs under its new row', () => {
    const { planned } = buildClassifierActions(
      reply([
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
    'roots a place whose parent %s, and reports why',
    (_label, parent, entities, cause) => {
      const { planned, parentDrops } = buildClassifierActions(
        reply([newPlace('new:inn', 'the Gull Inn', { parent })]),
        deps([...entities]),
      )
      expect(parentOf(planned, 'the Gull Inn')).toBeNull()
      expect(parentDrops).toEqual([{ handle: 'new:inn', parent, cause }])
    },
  )

  it('hangs a child under a new place whose own parent was dropped', () => {
    const { planned, parentDrops } = buildClassifierActions(
      reply([
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
        reply([
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
        reply([
          newPlace('new:mill', 'The Old Mill', { parent: 'loc_town', keywords: ['the mill'] }),
        ]),
        deps([TOWN, MILL]),
      )
      expect(planned).toEqual([])
    })

    it('hangs a child under the row its parent reused, and names it in an involvement', () => {
      const { planned } = buildClassifierActions(
        reply(
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
        reply([newPlace('new:cellar', 'the Cellar', { parent: 'loc_town' })]),
        deps([TOWN, vault, cellar]),
      )
      expect(handleMap.get('new:cellar')).toBe('loc_new1')
      expect(parentOf(planned, 'the Cellar')).toBe('loc_town')
    })

    it("compares a candidate only with its parent's real children", () => {
      const { planned } = buildClassifierActions(
        reply([newPlace('new:mill', 'The Old Mill')]),
        deps([TOWN, MILL]),
      )
      expect(createdPlaces(planned)).toEqual([
        expect.objectContaining({ name: 'The Old Mill', nameCollisionFlag: 0 }),
      ])
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
        reply([newPlace('new:mill', 'The Old Mill', { parent: 'loc_town' })]),
        deps([TOWN, contained, ruin]),
      )
      expect(flagOf(planned)).toEqual([1, 'loc_ruin', 'same-parent'])
    })

    it('flags a contained name', () => {
      const { planned } = buildClassifierActions(
        reply([newPlace('new:mill', 'Mill', { parent: 'loc_town' })]),
        deps([TOWN, placeRow('loc_old', 'Old Mill', 'loc_town')]),
      )
      expect(flagOf(planned)).toEqual([1, 'loc_old', 'same-parent'])
    })

    it("flags a sibling named among the entry's keywords, or whose keywords hold its name", () => {
      const ford = placeRow('loc_ford', 'Grey Ford', 'loc_town', { keywords: ['the crossing'] })
      const byEntry = buildClassifierActions(
        reply([newPlace('new:x', 'Ashwater', { parent: 'loc_town', keywords: ['grey ford'] })]),
        deps([TOWN, ford]),
      )
      expect(flagOf(byEntry.planned)).toEqual([1, 'loc_ford', 'same-parent'])
      const bySibling = buildClassifierActions(
        reply([newPlace('new:x', 'The Crossing', { parent: 'loc_town' })]),
        deps([TOWN, ford]),
      )
      expect(flagOf(bySibling.planned)).toEqual([1, 'loc_ford', 'same-parent'])
    })
  })

  describe('one reply', () => {
    it('maps a second place with the same name and parent to the first, appending its terms', () => {
      const { planned, handleMap } = buildClassifierActions(
        reply([
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

    it('creates both of two same-named places under different parents', () => {
      const { planned } = buildClassifierActions(
        reply([
          newPlace('new:a', 'the Cellar', { parent: 'loc_town' }),
          newPlace('new:b', 'the Cellar'),
        ]),
        deps([TOWN]),
      )
      expect(createdPlaces(planned).map((e) => e.state.parent_location_id)).toEqual([
        'loc_town',
        null,
      ])
    })

    it('keeps a handle bound to the newCharacters entry that claimed it, and the first place', () => {
      const { planned, handleMap, unresolvedRefs, droppedPlaces } = buildClassifierActions(
        reply(
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

    it('drops a blank-named place and reports it', () => {
      const { planned, unresolvedRefs, droppedPlaces } = buildClassifierActions(
        reply([newPlace('new:x', '   ')]),
        deps([]),
      )
      expect(planned).toEqual([])
      expect(droppedPlaces).toEqual([{ handle: 'new:x', name: '   ', cause: 'blank-name' }])
      expect(unresolvedRefs).toEqual([])
    })

    it("resolves a new place's handle as a site, never as a character", () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply([newPlace('new:inn', 'the Gull Inn')], {
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
  const reply = (over: Partial<ClassifierExtraction> = {}): ClassifierExtraction => ({
    happenings: [],
    relationships: [],
    statusFlips: [],
    newCharacters: [],
    newFactions: [],
    memberships: [],
    aliases: [],
    ...over,
  })
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
      expect(entry.state).toBeUndefined()
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

    it("keeps a handle a new character claimed, and never reads the character's decision", () => {
      const { planned, unresolvedRefs } = buildClassifierActions(
        reply({
          newCharacters: [{ ...circle, name: 'Circe' }],
          newFactions: [circle],
        }),
        deps([], { decisions: decided(create) }),
      )
      expect(planned).toHaveLength(1)
      expect(payloadOf<{ entry: { kind: string } }>(planned[0]).entry.kind).toBe('character')
      expect(unresolvedRefs).toEqual(['new:circle'])
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
