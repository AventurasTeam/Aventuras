import { describe, expect, it } from 'vitest'

import type { Delta } from '@/lib/db'

import { fieldPathLabel, pathsMatchingLabel } from './field-labels'
import { changedPaths, humanizeDelta, type HumanizeContext } from './humanize'
import type { HistoryRow, HistoryVia } from './link-rows'

const delta = (overrides: Partial<Delta>): Delta => ({
  id: 'delta_1',
  branchId: 'b1',
  entryId: null,
  actionId: 'act_1',
  logPosition: 1,
  source: 'user_edit',
  targetTable: 'entities',
  targetId: 'char_1',
  op: 'update',
  undoPayload: null,
  encodingVersion: 1,
  createdAt: 0,
  ...overrides,
})

const own = (row: Delta): HistoryRow => ({ delta: row, via: { kind: 'own' } })
const reaching = (row: Delta, via: HistoryVia): HistoryRow => ({ delta: row, via })

// Aria (char_aria) < Kael (char_kael), so Aria is side a of their row and holds `kind`.
const ON_ARIAS_TAB: HistoryVia = {
  kind: 'link',
  table: 'character_relationships',
  linkId: 'rel_1',
  otherId: 'char_kael',
  side: 'a',
}
const ON_KAELS_TAB: HistoryVia = {
  kind: 'link',
  table: 'character_relationships',
  linkId: 'rel_1',
  otherId: 'char_aria',
  side: 'b',
}

const NAMES: Readonly<Record<string, string>> = {
  char_aria: 'Aria',
  char_kael: 'Kael',
  hap_fire: 'The keep burns',
}

describe('changedPaths', () => {
  it('reads top-level columns, one level into state, one more into state.visual, and skips meta keys', () => {
    expect(
      changedPaths(
        delta({
          undoPayload: {
            description: 'x',
            state: { traits: [], visual: { hair: 'red' }, lastSeenAt: { worldTime: 1 } },
            $firstLoggedAt: 3,
          },
        }),
      ),
    ).toEqual(['description', 'state.traits', 'state.visual.hair', 'state.lastSeenAt'])
  })

  it('is empty for a create or a delete', () => {
    expect(changedPaths(delta({ op: 'create' }))).toEqual([])
    expect(changedPaths(delta({ op: 'delete', undoPayload: { id: 'x' } }))).toEqual([])
  })
})

describe('field labels', () => {
  it('labels a path by its nearest labelled ancestor', () => {
    expect(fieldPathLabel('entities', 'state.current_location_id')).toBe('Current location')
    expect(fieldPathLabel('entities', 'state.lastSeenAt.worldTime')).toBe('Last seen')
    expect(fieldPathLabel('lore', 'unknownColumn')).toBe('unknownColumn')
  })

  it('finds the paths whose label contains a term', () => {
    expect(pathsMatchingLabel('entities', 'location').sort()).toEqual([
      'state.at_location_id',
      'state.current_location_id',
      'state.parent_location_id',
    ])
  })
})

describe('humanizeDelta', () => {
  const context: HumanizeContext = {
    targetTable: 'entities',
    targetName: 'Kael',
    otherName: (id) => NAMES[id] ?? null,
    entryLabel: (id: string) => (id === 'entry_47' ? 'entry #47' : null),
    nowMs: 7_200_000,
  }

  it('summarizes an update by its labels and carries source, entry and time', () => {
    const view = humanizeDelta(
      own(
        delta({
          source: 'periodic_classifier',
          entryId: 'entry_47',
          undoPayload: { state: { traits: [], drives: [] } },
        }),
      ),
      context,
    )
    expect(view).toMatchObject({
      targetDisplayName: 'Kael',
      fieldPath: 'state.traits, state.drives',
      summary: 'Modified Traits, Drives',
      source: 'periodic_classifier',
      entryId: 'entry #47',
      createdAtRelative: '2h ago',
    })
  })

  it('renders a create and a delete as one-liners with no field path', () => {
    expect(humanizeDelta(own(delta({ op: 'create' })), context)).toMatchObject({
      summary: 'Created',
      fieldPath: null,
    })
    expect(
      humanizeDelta(own(delta({ op: 'delete', undoPayload: { id: 'x' } })), context),
    ).toMatchObject({ summary: 'Deleted', fieldPath: null })
  })

  it('labels threads and happenings by their own vocabulary', () => {
    expect(
      humanizeDelta(own(delta({ targetTable: 'threads', undoPayload: { status: 'active' } })), {
        ...context,
        targetTable: 'threads',
      }).summary,
    ).toBe('Modified Status')
    expect(
      humanizeDelta(
        own(delta({ targetTable: 'happenings', undoPayload: { commonKnowledge: 0 } })),
        { ...context, targetTable: 'happenings' },
      ).summary,
    ).toBe('Modified Common knowledge')
  })

  it('lists a shared label once when two changed paths fall back to the same ancestor', () => {
    const view = humanizeDelta(
      own(delta({ undoPayload: { state: { visual: { customA: 'x', customB: 'y' } } } })),
      context,
    )
    expect(view.fieldPath).toBe('state.visual.customA, state.visual.customB')
    expect(view.summary).toBe('Modified Appearance')
  })

  it('labels a collision-flag clear', () => {
    const view = humanizeDelta(own(delta({ undoPayload: { nameCollisionFlag: 1 } })), context)
    expect(view.summary).toBe('Modified Collision flag')
    expect(view.fieldPath).toBe('nameCollisionFlag')
  })

  it('falls back to "Modified" with no field path when an update carries no readable columns', () => {
    const view = humanizeDelta(own(delta({ undoPayload: {} })), context)
    expect(view.summary).toBe('Modified')
    expect(view.fieldPath).toBeNull()
  })

  it('names a link row by its link and its other end, and keeps its create and delete one-liners', () => {
    const link = { targetTable: 'character_relationships', targetId: 'rel_1' }
    expect(
      humanizeDelta(reaching(delta({ ...link, op: 'create' }), ON_ARIAS_TAB), context),
    ).toMatchObject({
      targetTable: 'character_relationships',
      targetDisplayName: 'Relationship · Kael',
      summary: 'Created',
      fieldPath: null,
    })
    expect(
      humanizeDelta(
        reaching(
          delta({ ...link, op: 'delete', undoPayload: { id: 'rel_1', kind: 'ally' } }),
          ON_ARIAS_TAB,
        ),
        context,
      ),
    ).toMatchObject({ summary: 'Deleted', fieldPath: null })
  })

  it("labels a relationship edit from the tab's side of the pair", () => {
    const edit = delta({
      targetTable: 'character_relationships',
      targetId: 'rel_1',
      undoPayload: { inverseKind: 'rival' },
    })
    expect(humanizeDelta(reaching(edit, ON_ARIAS_TAB), context)).toMatchObject({
      summary: 'Modified Their view',
      fieldPath: 'inverseKind',
    })
    expect(humanizeDelta(reaching(edit, ON_KAELS_TAB), context)).toMatchObject({
      targetDisplayName: 'Relationship · Aria',
      summary: 'Modified Your view',
      fieldPath: 'inverseKind',
    })
  })

  it('labels involvement and awareness edits, named by their happening', () => {
    const involvement: HistoryVia = {
      kind: 'link',
      table: 'happening_involvements',
      linkId: 'hinv_1',
      otherId: 'hap_fire',
      side: null,
    }
    expect(
      humanizeDelta(
        reaching(
          delta({ targetTable: 'happening_involvements', undoPayload: { role: null } }),
          involvement,
        ),
        context,
      ),
    ).toMatchObject({ targetDisplayName: 'Involvement · The keep burns', summary: 'Modified Role' })
    const awareness: HistoryVia = {
      kind: 'link',
      table: 'happening_awareness',
      linkId: 'haw_1',
      otherId: 'hap_fire',
      side: null,
    }
    expect(
      humanizeDelta(
        reaching(
          delta({
            targetTable: 'happening_awareness',
            undoPayload: { source: null, decayResistance: 0.5, learnedAtEntryId: null },
          }),
          awareness,
        ),
        context,
      ),
    ).toMatchObject({
      targetDisplayName: 'Awareness · The keep burns',
      summary: 'Modified Source, Decay resistance, Learned at',
    })
  })

  it("reads the other end's delete as a removal under the link label", () => {
    const deleted = delta({
      targetId: 'char_kael',
      op: 'delete',
      undoPayload: { id: 'char_kael', name: 'Kael' },
    })
    expect(
      humanizeDelta(
        reaching(deleted, {
          kind: 'removed',
          tables: ['character_relationships'],
          otherId: 'char_kael',
        }),
        context,
      ),
    ).toMatchObject({
      targetDisplayName: 'Relationship',
      summary: 'Removed when Kael was deleted',
      fieldPath: null,
    })
    expect(
      humanizeDelta(
        reaching(deleted, {
          kind: 'removed',
          tables: ['happening_involvements', 'happening_awareness'],
          otherId: 'char_kael',
        }),
        context,
      ).targetDisplayName,
    ).toBe('Links')
  })

  it('names an other end it cannot resolve "Unknown row"', () => {
    const gone: HistoryVia = {
      kind: 'link',
      table: 'happening_awareness',
      linkId: 'haw_9',
      otherId: 'hap_gone',
      side: null,
    }
    expect(
      humanizeDelta(
        reaching(delta({ targetTable: 'happening_awareness', op: 'create' }), gone),
        context,
      ).targetDisplayName,
    ).toBe('Awareness · Unknown row')
    expect(
      humanizeDelta(
        reaching(delta({ targetId: 'char_gone', op: 'delete', undoPayload: {} }), {
          kind: 'removed',
          tables: ['character_relationships'],
          otherId: 'char_gone',
        }),
        context,
      ).summary,
    ).toBe('Removed when Unknown row was deleted')
  })
})
