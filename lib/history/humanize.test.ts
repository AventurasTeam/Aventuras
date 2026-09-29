import { describe, expect, it } from 'vitest'

import type { Delta } from '@/lib/db'

import { fieldPathLabel, pathsMatchingLabel } from './field-labels'
import { changedPaths, humanizeDelta } from './humanize'

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
  const context = {
    targetTable: 'entities' as const,
    targetName: 'Kael',
    entryLabel: (id: string) => (id === 'entry_47' ? 'entry #47' : null),
    nowMs: 7_200_000,
  }

  it('summarizes an update by its labels and carries source, entry and time', () => {
    const view = humanizeDelta(
      delta({
        source: 'periodic_classifier',
        entryId: 'entry_47',
        undoPayload: { state: { traits: [], drives: [] } },
      }),
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
    expect(humanizeDelta(delta({ op: 'create' }), context)).toMatchObject({
      summary: 'Created',
      fieldPath: null,
    })
    expect(humanizeDelta(delta({ op: 'delete', undoPayload: { id: 'x' } }), context)).toMatchObject(
      { summary: 'Deleted', fieldPath: null },
    )
  })

  it('labels threads and happenings by their own vocabulary', () => {
    expect(
      humanizeDelta(delta({ targetTable: 'threads', undoPayload: { status: 'active' } }), {
        ...context,
        targetTable: 'threads',
      }).summary,
    ).toBe('Modified Status')
    expect(
      humanizeDelta(delta({ targetTable: 'happenings', undoPayload: { commonKnowledge: 0 } }), {
        ...context,
        targetTable: 'happenings',
      }).summary,
    ).toBe('Modified Common knowledge')
  })

  it('lists a shared label once when two changed paths fall back to the same ancestor', () => {
    const view = humanizeDelta(
      delta({ undoPayload: { state: { visual: { customA: 'x', customB: 'y' } } } }),
      context,
    )
    expect(view.fieldPath).toBe('state.visual.customA, state.visual.customB')
    expect(view.summary).toBe('Modified Appearance')
  })

  it('falls back to "Modified" with no field path when an update carries no readable columns', () => {
    const view = humanizeDelta(delta({ undoPayload: {} }), context)
    expect(view.summary).toBe('Modified')
    expect(view.fieldPath).toBeNull()
  })
})
