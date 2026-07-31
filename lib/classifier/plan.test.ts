import { describe, expect, it } from 'vitest'

import { buildClassifierActions, type PlannedWrite } from './plan'
import type { ReconcileDecision } from './reconcile'
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

// Minimal entity fixture: the planner reads only id / kind / name / status.
const entityRow = (id: string, status = 'active', name = id) =>
  ({ id, branchId: 'branch_1', kind: 'character', name, description: 'x', status }) as never

const nonCharacterRow = (id: string, kind: string) =>
  ({ id, branchId: 'branch_1', kind, name: id, description: 'x', status: 'active' }) as never

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
      },
      base,
    )
    const involvement = planned.find((p) => p.action.kind === 'createHappeningInvolvement')
    const awareness = planned.find((p) => p.action.kind === 'upsertHappeningAwareness')
    expect(involvement?.entryId).toBe('e1')
    expect(awareness?.entryId).toBe('e3')
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
      },
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'upsertCharacterRelationship',
      source: 'periodic_classifier',
      payload: { subjectId: 'char_kael', objectId: 'char_aria', kind: 'sister' },
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
      },
      base,
    )
    expect(planned[0].action).toMatchObject({
      kind: 'updateEntity',
      payload: {
        id: 'char_kael',
        patch: { status: 'retired', retiredReason: 'killed at the ford' },
      },
    })
    expect(planned[0].entryId).toBe('e2')
  })

  it('creates a new character with the reconcile decision applied', () => {
    const decisions = new Map<string, ReconcileDecision>([
      ['h1', { kind: 'create', flagged: true, similarity: 0.6, flagReason: 'ambiguous' }],
    ])
    const { planned, handleMap } = buildClassifierActions(
      {
        happenings: [],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          { handle: 'h1', name: 'Eldrin', description: 'A dragon.', sourceTurn: 't1' },
        ],
      },
      { ...base, decisions },
    )
    expect(planned[0].action).toMatchObject({
      kind: 'createEntity',
      payload: {
        entry: { name: 'Eldrin', status: 'active', nameCollisionFlag: 1, embeddingStale: 1 },
      },
    })
    expect(handleMap.get('h1')).toBe(payloadOf<{ entry: { id: string } }>(planned[0]).entry.id)
    expect(planned[0].entryId).toBe('e1')
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
          { handle: 'h1', name: 'Eldrin', description: 'The keeper.', sourceTurn: 't1' },
        ],
      },
      { ...base, decisions },
    )
    expect(planned).toHaveLength(1)
    expect(planned[0].action).toMatchObject({
      kind: 'updateEntity',
      payload: { id: 'char_1', patch: { status: 'active' } },
    })
  })

  it('resolves a temp handle used later in the same reply to the allocated id', () => {
    const decisions = new Map<string, ReconcileDecision>([
      ['h1', { kind: 'create', flagged: false }],
    ])
    const { planned } = buildClassifierActions(
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [
          { handle: 'h1', name: 'Eldrin', description: 'The keeper.', sourceTurn: 't1' },
        ],
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
      },
      base,
    )
    expect(planned.filter((p) => p.action.kind === 'createHappeningInvolvement')).toHaveLength(0)
    expect(unresolvedRefs).toEqual(['nope'])
  })

  it('orders creates before the rows that reference them', () => {
    const decisions = new Map<string, ReconcileDecision>([
      ['h1', { kind: 'create', flagged: false }],
    ])
    const { planned } = buildClassifierActions(
      {
        happenings: [
          { title: 'A', sourceTurn: 't1', involvements: [{ ref: 'h1' }], awareness: [] },
        ],
        relationships: [],
        statusFlips: [],
        newCharacters: [{ handle: 'h1', name: 'Eldrin', description: 'x', sourceTurn: 't1' }],
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
          newCharacters: [{ handle: 'h9', name: 'Eldrin', description: 'x', sourceTurn: 't1' }],
        },
        base,
      )
      expect(planned).toHaveLength(0)
      expect(unresolvedRefs).toEqual(['h9'])
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
          newCharacters: [{ handle: 'h1', name: 'char_a', description: 'x', sourceTurn: 't1' }],
        },
        { ...base, decisions },
      )
      expect(planned).toHaveLength(0)
      expect(handleMap.get('h1')).toBe('char_a')
    })

    // Rebinding the handle would retarget every ref emitted before the duplicate,
    // including ones the model wrote for the first character.
    it('keeps the first binding when a handle is reused, and reports the collision', () => {
      const decisions = new Map<string, ReconcileDecision>([
        ['h1', { kind: 'create', flagged: false }],
      ])
      const { planned, handleMap, unresolvedRefs } = buildClassifierActions(
        {
          happenings: [],
          relationships: [],
          statusFlips: [],
          newCharacters: [
            { handle: 'h1', name: 'First', description: 'x', sourceTurn: 't1' },
            { handle: 'h1', name: 'Second', description: 'y', sourceTurn: 't1' },
          ],
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
        },
        { ...base, entities },
      )

    it('promotes a staged entity to active', () => {
      const { planned } = flip('char_s', 'active', [entityRow('char_s', 'staged')])
      expect(planned[0].action).toMatchObject({
        kind: 'updateEntity',
        payload: { id: 'char_s', patch: { status: 'active' } },
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
          newCharacters: [{ handle: 'h1', name: 'char_s', description: 'x', sourceTurn: 't1' }],
        },
        { ...base, decisions, entities: [entityRow('char_s', 'staged')] },
      )
      expect(planned.map((p) => p.action.kind)).toEqual(['updateEntity', 'updateEntity'])
      expect(planned[1].action).toMatchObject({
        payload: { id: 'char_s', patch: { status: 'retired', retiredReason: 'fell' } },
      })
    })

    it('retires a character created earlier in the same reply', () => {
      const decisions = new Map<string, ReconcileDecision>([
        ['h1', { kind: 'create', flagged: false }],
      ])
      const { planned } = buildClassifierActions(
        {
          happenings: [],
          relationships: [],
          statusFlips: [{ ref: 'h1', to: 'retired', reason: 'fell', sourceTurn: 't2' }],
          newCharacters: [{ handle: 'h1', name: 'Eldrin', description: 'x', sourceTurn: 't1' }],
        },
        { ...base, decisions },
      )
      const createdId = payloadOf<{ entry: { id: string } }>(planned[0]).entry.id
      expect(planned[1].action).toMatchObject({
        kind: 'updateEntity',
        payload: { id: createdId, patch: { status: 'retired' } },
      })
    })
  })
})
