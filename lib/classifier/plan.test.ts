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
})
