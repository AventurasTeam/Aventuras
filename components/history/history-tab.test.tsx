// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CharacterRelationship, Delta, Happening, HappeningAwareness } from '@/lib/db'
import type { HistoryChunk, HistoryQuery, HistoryRow, HistoryTable } from '@/lib/history'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningsStore,
} from '@/lib/stores'

import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { HistoryTab } from './history-tab'
import type { HistoryTabViewProps } from './history-tab-view'

const view = vi.hoisted(() => ({ props: null as HistoryTabViewProps | null, renders: 0 }))
vi.mock('./history-tab-view', () => ({
  HistoryTabView: (props: HistoryTabViewProps) => {
    view.props = props
    view.renders += 1
    return null
  },
}))

// The real hook reads the app database, which a unit test has none of.
const entryIndex = vi.hoisted(() => ({
  entries: [],
  index: new Map(),
  ready: true,
  failed: false,
  retry: () => {},
}))
vi.mock('@/hooks/use-entry-index', () => ({ useEntryIndex: () => entryIndex }))

const BRANCH = 'br_1'

// Aria (char_aria) < Kael (char_kael): Aria is side a and holds `kind`; this edit is Kael's view.
const VIEW_EDIT: Delta = {
  id: 'delta_view',
  branchId: BRANCH,
  entryId: null,
  actionId: 'act_1',
  logPosition: 2,
  source: 'user_edit',
  targetTable: 'character_relationships',
  targetId: 'rel_1',
  op: 'update',
  undoPayload: { inverseKind: 'rival' },
  encodingVersion: 1,
  createdAt: 0,
}

const ON_ARIAS_TAB: HistoryRow = {
  delta: VIEW_EDIT,
  via: {
    kind: 'link',
    table: 'character_relationships',
    linkId: 'rel_1',
    otherId: 'char_kael',
    side: 'a',
  },
}

const INVOLVES_FIRE: HistoryRow = {
  delta: {
    ...VIEW_EDIT,
    targetTable: 'happening_involvements',
    targetId: 'inv_1',
    op: 'create',
    undoPayload: null,
  },
  via: {
    kind: 'link',
    table: 'happening_involvements',
    linkId: 'inv_1',
    otherId: 'hap_fire',
    side: null,
  },
}

const fire = (branchId: string, title: string): Happening => ({
  id: 'hap_fire',
  branchId,
  title,
  description: null,
  category: null,
  icon: null,
  temporal: null,
  occurredAtEntryId: null,
  commonKnowledge: 1,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
})

function relationship(id: string, aId: string, bId: string): CharacterRelationship {
  return {
    id,
    branchId: BRANCH,
    aId,
    bId,
    kind: 'ally',
    inverseKind: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function awareness(id: string, characterId: string): HappeningAwareness {
  return {
    id,
    branchId: BRANCH,
    happeningId: 'hap_fire',
    characterId,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

function loader(rows: (query: HistoryQuery) => HistoryRow[], names: Record<string, string> = {}) {
  return vi.fn(
    async (query: HistoryQuery): Promise<HistoryChunk> => ({
      rows: rows(query),
      nextCursor: null,
      names,
    }),
  )
}

function renderTab(load: HistoryLoader, targetId: string, targetTable: HistoryTable = 'entities') {
  view.props = null
  view.renders = 0
  return render(
    <HistoryLoaderProvider value={load}>
      <HistoryTab branchId={BRANCH} targetTable={targetTable} targetId={targetId} />
    </HistoryLoaderProvider>,
  )
}

async function firstRow() {
  await waitFor(() => expect(view.props?.rows).toHaveLength(1))
  return view.props?.rows[0]
}

beforeEach(() => {
  entitiesStore.__reset()
  happeningsStore.__reset()
  characterRelationshipsStore.__reset()
  happeningAwarenessStore.__reset()
  generationStore.__reset()
  entitiesStore.hydrate(BRANCH, [
    makeEntity({ id: 'char_aria', kind: 'character', name: 'Aria' }),
    makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' }),
    makeEntity({ id: 'char_mira', kind: 'character', name: 'Mira' }),
  ])
})

afterEach(cleanup)

describe('HistoryTab over the link-row union', () => {
  it("names a relationship edit by its link and other end, labelled from the tab's side", async () => {
    const load = loader((query) => [
      query.targetId === 'char_aria'
        ? ON_ARIAS_TAB
        : {
            delta: VIEW_EDIT,
            via: {
              kind: 'link',
              table: 'character_relationships',
              linkId: 'rel_1',
              otherId: 'char_aria',
              side: 'b',
            },
          },
    ])
    renderTab(load, 'char_aria')
    expect(await firstRow()).toMatchObject({
      targetDisplayName: 'Relationship · Kael',
      summary: 'Modified Their view',
      fieldPath: 'inverseKind',
    })
    cleanup()
    renderTab(load, 'char_kael')
    expect(await firstRow()).toMatchObject({
      targetDisplayName: 'Relationship · Aria',
      summary: 'Modified Your view',
    })
  })

  it("reads a deleted other end's name from the chunk once the working set no longer holds it", async () => {
    act(() => entitiesStore.patch(BRANCH, { op: 'delete', id: 'char_kael' }))
    const kaelDeleted: Delta = {
      ...VIEW_EDIT,
      id: 'delta_gone',
      targetTable: 'entities',
      targetId: 'char_kael',
      op: 'delete',
      undoPayload: { id: 'char_kael', name: 'Kael' },
    }
    const load = loader(
      () => [
        {
          delta: kaelDeleted,
          via: { kind: 'removed', tables: ['character_relationships'], otherId: 'char_kael' },
        },
      ],
      { char_kael: 'Kael' },
    )
    renderTab(load, 'char_aria')
    expect(await firstRow()).toMatchObject({
      targetDisplayName: 'Relationship',
      summary: 'Removed when Kael was deleted',
      fieldPath: null,
    })
  })

  it("prefers the working set's name, so a renamed other end reads its new name without a refetch", async () => {
    const load = loader(() => [ON_ARIAS_TAB], { char_kael: 'Kael (as deleted)' })
    renderTab(load, 'char_aria')
    expect((await firstRow())?.targetDisplayName).toBe('Relationship · Kael')
    act(() =>
      entitiesStore.patch(BRANCH, {
        op: 'update',
        id: 'char_kael',
        columns: { name: 'Kael the Elder' },
      }),
    )
    await waitFor(() =>
      expect(view.props?.rows[0]?.targetDisplayName).toBe('Relationship · Kael the Elder'),
    )
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("prefers a happening's working-set title over the chunk's name", async () => {
    happeningsStore.hydrate(BRANCH, [fire(BRANCH, 'The keep burns')])
    renderTab(
      loader(() => [INVOLVES_FIRE], { hap_fire: 'The keep (old)' }),
      'char_aria',
    )
    expect((await firstRow())?.targetDisplayName).toBe('Involvement · The keep burns')
  })

  it('ignores a working-set row of another branch that shares the other end id', async () => {
    entitiesStore.hydrate('br_other', [
      makeEntity({ id: 'char_kael', branchId: 'br_other', kind: 'character', name: 'Imposter' }),
    ])
    const load = loader(() => [ON_ARIAS_TAB], { char_kael: 'Kael' })
    renderTab(load, 'char_aria')
    expect((await firstRow())?.targetDisplayName).toBe('Relationship · Kael')
    cleanup()
    happeningsStore.hydrate('br_other', [fire('br_other', 'Imposter keep')])
    renderTab(
      loader(() => [INVOLVES_FIRE], { hap_fire: 'The keep' }),
      'char_aria',
    )
    expect((await firstRow())?.targetDisplayName).toBe('Involvement · The keep')
  })

  it('re-renders for a rename of a shown other end, not of an unrelated row', async () => {
    const load = loader(() => [ON_ARIAS_TAB])
    renderTab(load, 'char_aria')
    await firstRow()
    await act(async () => {})
    const settled = view.renders
    act(() =>
      entitiesStore.patch(BRANCH, { op: 'update', id: 'char_mira', columns: { name: 'Mira II' } }),
    )
    expect(view.renders).toBe(settled)
    act(() =>
      entitiesStore.patch(BRANCH, { op: 'update', id: 'char_kael', columns: { name: 'Kael II' } }),
    )
    expect(view.props?.rows[0]?.targetDisplayName).toBe('Relationship · Kael II')
    expect(view.renders).toBeGreaterThan(settled)
  })

  it("names a happening's awareness row by its character", async () => {
    const load = loader(() => [
      {
        delta: {
          ...VIEW_EDIT,
          targetTable: 'happening_awareness',
          targetId: 'haw_1',
          op: 'create',
          undoPayload: null,
        },
        via: {
          kind: 'link',
          table: 'happening_awareness',
          linkId: 'haw_1',
          otherId: 'char_mira',
          side: null,
        },
      },
    ])
    renderTab(load, 'hap_fire', 'happenings')
    expect(await firstRow()).toMatchObject({
      targetDisplayName: 'Awareness · Mira',
      summary: 'Created',
    })
  })

  it('refetches when a link row naming the target changes, not for another row or a retrieval bump', async () => {
    characterRelationshipsStore.hydrate(BRANCH, [
      relationship('rel_1', 'char_aria', 'char_kael'),
      relationship('rel_2', 'char_kael', 'char_mira'),
    ])
    happeningAwarenessStore.hydrate(BRANCH, [awareness('haw_1', 'char_aria')])
    const load = loader(() => [])
    renderTab(load, 'char_aria')
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    act(() => {
      characterRelationshipsStore.patch(BRANCH, {
        op: 'update',
        id: 'rel_2',
        columns: { kind: 'enemy' },
      })
      happeningAwarenessStore.patch(BRANCH, {
        op: 'update',
        id: 'haw_1',
        columns: { retrievalCount: 4 },
      })
    })
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(1)

    act(() =>
      characterRelationshipsStore.patch(BRANCH, {
        op: 'update',
        id: 'rel_1',
        columns: { inverseKind: 'rival' },
      }),
    )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetId: 'char_aria', cursor: null }),
    )

    act(() =>
      happeningAwarenessStore.patch(BRANCH, {
        op: 'create',
        id: 'haw_2',
        row: awareness('haw_2', 'char_aria'),
      }),
    )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
  })
})
