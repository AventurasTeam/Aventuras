// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { CharacterRelationship, HappeningAwareness, HappeningInvolvement } from '@/lib/db'
import type { HistoryTable } from '@/lib/history'
import {
  characterRelationshipsStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
} from '@/lib/stores'

import { useLinkVersion } from './use-link-version'

const BRANCH = 'br_1'

const relationship = (
  id: string,
  aId: string,
  bId: string,
  over: Partial<CharacterRelationship> = {},
): CharacterRelationship => ({
  id,
  branchId: BRANCH,
  aId,
  bId,
  kind: 'ally',
  inverseKind: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

const involvement = (
  id: string,
  happeningId: string,
  entityId: string,
  over: Partial<HappeningInvolvement> = {},
): HappeningInvolvement => ({ id, branchId: BRANCH, happeningId, entityId, role: null, ...over })

const awareness = (
  id: string,
  happeningId: string,
  characterId: string,
  over: Partial<HappeningAwareness> = {},
): HappeningAwareness => ({
  id,
  branchId: BRANCH,
  happeningId,
  characterId,
  learnedAtEntryId: null,
  decayResistance: null,
  retrievalCount: 0,
  source: null,
  ...over,
})

// `char_a` is an entity tab's target and `hap_x` a happening tab's. The `cross` rows name the
// other table's target in the wrong column, so a version that mixes the columns shows.
function hydrateWorld(branchId = BRANCH, tag: Partial<{ branchId: string }> = {}) {
  characterRelationshipsStore.hydrate(branchId, [
    relationship('rel_ab', 'char_a', 'char_b', tag),
    relationship('rel_ca', 'char_c', 'char_a', tag),
    relationship('rel_bc', 'char_b', 'char_c', tag),
    relationship('rel_cross', 'hap_x', 'char_z', tag),
  ])
  happeningInvolvementsStore.hydrate(branchId, [
    involvement('inv_a', 'hap_1', 'char_a', { role: 'witness', ...tag }),
    involvement('inv_x', 'hap_x', 'char_b', { role: 'victim', ...tag }),
    involvement('inv_other', 'hap_1', 'char_b', tag),
    involvement('inv_cross_h', 'char_a', 'char_z', tag),
    involvement('inv_cross_e', 'hap_1', 'hap_x', tag),
  ])
  happeningAwarenessStore.hydrate(branchId, [
    awareness('aw_a', 'hap_1', 'char_a', tag),
    awareness('aw_x', 'hap_x', 'char_b', tag),
    awareness('aw_other', 'hap_1', 'char_b', tag),
    awareness('aw_cross_h', 'char_a', 'char_z', tag),
    awareness('aw_cross_c', 'hap_1', 'hap_x', tag),
  ])
}

const rel = (id: string, columns: Record<string, unknown>) => () =>
  characterRelationshipsStore.patch(BRANCH, { op: 'update', id, columns })
const inv = (id: string, columns: Record<string, unknown>) => () =>
  happeningInvolvementsStore.patch(BRANCH, { op: 'update', id, columns })
const aw = (id: string, columns: Record<string, unknown>) => () =>
  happeningAwarenessStore.patch(BRANCH, { op: 'update', id, columns })

type Edit = { name: string; run: () => void }

const ENTITY_EDITS: { changes: Edit[]; leaves: Edit[] } = {
  changes: [
    { name: 'a relationship kind (target is side a)', run: rel('rel_ab', { kind: 'enemy' }) },
    { name: 'a relationship inverseKind', run: rel('rel_ab', { inverseKind: 'rival' }) },
    { name: 'a relationship kind (target is side b)', run: rel('rel_ca', { kind: 'enemy' }) },
    {
      name: 'a relationship inverseKind (target is side b)',
      run: rel('rel_ca', { inverseKind: 'rival' }),
    },
    {
      name: 'a relationship create',
      run: () =>
        characterRelationshipsStore.patch(BRANCH, {
          op: 'create',
          id: 'rel_new',
          row: relationship('rel_new', 'char_a', 'char_d'),
        }),
    },
    {
      name: 'a relationship create (target is side b)',
      run: () =>
        characterRelationshipsStore.patch(BRANCH, {
          op: 'create',
          id: 'rel_new',
          row: relationship('rel_new', 'char_0', 'char_a'),
        }),
    },
    {
      name: 'a relationship delete',
      run: () => characterRelationshipsStore.patch(BRANCH, { op: 'delete', id: 'rel_ab' }),
    },
    { name: 'an involvement role', run: inv('inv_a', { role: 'bystander' }) },
    {
      name: 'an involvement create',
      run: () =>
        happeningInvolvementsStore.patch(BRANCH, {
          op: 'create',
          id: 'inv_new',
          row: involvement('inv_new', 'hap_2', 'char_a'),
        }),
    },
    {
      name: 'an involvement delete',
      run: () => happeningInvolvementsStore.patch(BRANCH, { op: 'delete', id: 'inv_a' }),
    },
    { name: 'an awareness source', run: aw('aw_a', { source: 'witnessed' }) },
    { name: 'an awareness decayResistance', run: aw('aw_a', { decayResistance: 3 }) },
    { name: 'an awareness learnedAtEntryId', run: aw('aw_a', { learnedAtEntryId: 'entry_1' }) },
    {
      name: 'an awareness create',
      run: () =>
        happeningAwarenessStore.patch(BRANCH, {
          op: 'create',
          id: 'aw_new',
          row: awareness('aw_new', 'hap_2', 'char_a'),
        }),
    },
    {
      name: 'an awareness delete',
      run: () => happeningAwarenessStore.patch(BRANCH, { op: 'delete', id: 'aw_a' }),
    },
  ],
  leaves: [
    { name: 'a relationship naming neither end', run: rel('rel_bc', { kind: 'enemy' }) },
    { name: 'a relationship naming a happening id', run: rel('rel_cross', { kind: 'enemy' }) },
    { name: 'an involvement of another entity', run: inv('inv_other', { role: 'x' }) },
    {
      name: 'an involvement naming the id as its happening',
      run: inv('inv_cross_h', { role: 'x' }),
    },
    { name: 'an awareness of another character', run: aw('aw_other', { source: 'x' }) },
    { name: 'an awareness naming the id as its happening', run: aw('aw_cross_h', { source: 'x' }) },
    { name: 'an awareness retrieval bump', run: aw('aw_a', { retrievalCount: 9 }) },
    {
      name: 'an awareness create naming another character',
      run: () =>
        happeningAwarenessStore.patch(BRANCH, {
          op: 'create',
          id: 'aw_new',
          row: awareness('aw_new', 'hap_2', 'char_b'),
        }),
    },
  ],
}

const HAPPENING_EDITS: { changes: Edit[]; leaves: Edit[] } = {
  changes: [
    { name: 'an involvement role', run: inv('inv_x', { role: 'survivor' }) },
    {
      name: 'an involvement create',
      run: () =>
        happeningInvolvementsStore.patch(BRANCH, {
          op: 'create',
          id: 'inv_new',
          row: involvement('inv_new', 'hap_x', 'char_a'),
        }),
    },
    {
      name: 'an involvement delete',
      run: () => happeningInvolvementsStore.patch(BRANCH, { op: 'delete', id: 'inv_x' }),
    },
    { name: 'an awareness source', run: aw('aw_x', { source: 'rumour' }) },
    { name: 'an awareness decayResistance', run: aw('aw_x', { decayResistance: 2 }) },
    { name: 'an awareness learnedAtEntryId', run: aw('aw_x', { learnedAtEntryId: 'entry_2' }) },
    {
      name: 'an awareness create',
      run: () =>
        happeningAwarenessStore.patch(BRANCH, {
          op: 'create',
          id: 'aw_new',
          row: awareness('aw_new', 'hap_x', 'char_a'),
        }),
    },
    {
      name: 'an awareness delete',
      run: () => happeningAwarenessStore.patch(BRANCH, { op: 'delete', id: 'aw_x' }),
    },
  ],
  leaves: [
    { name: 'an involvement in another happening', run: inv('inv_other', { role: 'x' }) },
    { name: 'an involvement naming the id as its entity', run: inv('inv_cross_e', { role: 'x' }) },
    { name: 'an awareness of another happening', run: aw('aw_other', { source: 'x' }) },
    { name: 'an awareness naming the id as its character', run: aw('aw_cross_c', { source: 'x' }) },
    { name: 'an awareness retrieval bump', run: aw('aw_x', { retrievalCount: 9 }) },
    { name: 'a relationship naming the id', run: rel('rel_cross', { kind: 'enemy' }) },
  ],
}

function mountVersion(table: HistoryTable, id: string, branchId = BRANCH) {
  return renderHook(() => useLinkVersion(table, id, branchId))
}

function versionAfter(table: HistoryTable, id: string, edit: Edit): [string, string] {
  const hook = mountVersion(table, id)
  const before = hook.result.current
  act(edit.run)
  return [before, hook.result.current]
}

beforeEach(() => {
  characterRelationshipsStore.__reset()
  happeningInvolvementsStore.__reset()
  happeningAwarenessStore.__reset()
  hydrateWorld()
})

afterEach(cleanup)

describe.each([
  ['entities', 'char_a', ENTITY_EDITS],
  ['happenings', 'hap_x', HAPPENING_EDITS],
] as const)('useLinkVersion on a %s tab', (table, id, edits) => {
  it.each(edits.changes)('changes for $name', (edit) => {
    const [before, after] = versionAfter(table, id, edit)
    expect(after).not.toBe(before)
  })

  it.each(edits.leaves)('is unchanged by $name', (edit) => {
    const [before, after] = versionAfter(table, id, edit)
    expect(after).toBe(before)
  })
})

describe.each(['lore', 'threads'] as const)('useLinkVersion on a %s tab', (table) => {
  it.each([
    ...ENTITY_EDITS.changes.map((edit) => ({ id: 'char_a', edit })),
    ...HAPPENING_EDITS.changes.map((edit) => ({ id: 'hap_x', edit })),
  ])('reads no link rows: $id, $edit.name', ({ id, edit }) => {
    const [before, after] = versionAfter(table, id, edit)
    expect(after).toBe(before)
  })
})

describe('useLinkVersion across branches', () => {
  it('ignores rows of another branch that share the target id', () => {
    characterRelationshipsStore.__reset()
    happeningInvolvementsStore.__reset()
    happeningAwarenessStore.__reset()
    const empty = mountVersion('entities', 'char_a').result.current
    hydrateWorld('br_other', { branchId: 'br_other' })
    const hook = mountVersion('entities', 'char_a')
    expect(hook.result.current).toBe(empty)
    expect(mountVersion('happenings', 'hap_x').result.current).toBe(
      mountVersion('happenings', 'hap_nowhere').result.current,
    )
  })
})
