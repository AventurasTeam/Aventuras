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
  happeningInvolvementsStore,
  happeningsStore,
} from '@/lib/stores'

import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { HistoryTab, REFRESH_COALESCE_MS } from './history-tab'
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

// A refetch waits for its triggers to hold still, so "no refetch" holds only once that has passed.
const pastCoalescing = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, REFRESH_COALESCE_MS * 2)))

async function firstRow() {
  await waitFor(() => expect(view.props?.rows).toHaveLength(1))
  return view.props?.rows[0]
}

beforeEach(() => {
  entitiesStore.__reset()
  happeningsStore.__reset()
  characterRelationshipsStore.__reset()
  happeningAwarenessStore.__reset()
  happeningInvolvementsStore.__reset()
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
    // An other end the working set never held hasn't left it, so it doesn't refetch.
    await pastCoalescing()
    expect(load).toHaveBeenCalledTimes(1)
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
    await pastCoalescing()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('refetches when a shown other end leaves the working set, so its name comes from its delete', async () => {
    happeningsStore.hydrate(BRANCH, [fire(BRANCH, 'Fire')])
    const awarenessGone: HistoryRow = {
      delta: { ...VIEW_EDIT, targetTable: 'happening_awareness', targetId: 'haw_1', op: 'delete' },
      via: {
        kind: 'link',
        table: 'happening_awareness',
        linkId: 'haw_1',
        otherId: 'hap_fire',
        side: null,
      },
    }
    // What the loader reads for the other end: live title while it lives, then its delete payload.
    let fireName = 'Fire'
    const load = vi.fn(
      async (): Promise<HistoryChunk> => ({
        rows: [awarenessGone],
        nextCursor: null,
        names: { hap_fire: fireName },
      }),
    )
    renderTab(load, 'char_aria')
    expect((await firstRow())?.targetDisplayName).toBe('Awareness · Fire')
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Blaze' } }),
    )
    expect(view.props?.rows[0]?.targetDisplayName).toBe('Awareness · Blaze')
    fireName = 'Blaze'
    act(() => happeningsStore.patch(BRANCH, { op: 'delete', id: 'hap_fire' }))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(view.props?.rows[0]?.targetDisplayName).toBe('Awareness · Blaze'))
  })

  it("refetches for a shown other end's rename while a search is set, as the match is server-side", async () => {
    happeningsStore.hydrate(BRANCH, [fire(BRANCH, 'Fire')])
    const load = loader(() => [INVOLVES_FIRE], { hap_fire: 'Fire' })
    renderTab(load, 'char_aria')
    await firstRow()
    act(() => view.props?.onSearchChange('fire'))
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'fire' })),
    )
    await firstRow()
    const searched = load.mock.calls.length
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Blaze' } }),
    )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(searched + 1))
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'fire', cursor: null }))
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
    happeningsStore.hydrate(BRANCH, [
      fire(BRANCH, 'The keep burns'),
      { ...fire(BRANCH, 'The flood'), id: 'hap_flood' },
    ])
    const load = loader(() => [ON_ARIAS_TAB, INVOLVES_FIRE])
    renderTab(load, 'char_aria')
    await waitFor(() => expect(view.props?.rows).toHaveLength(2))
    await act(async () => {})
    const settled = view.renders
    act(() => {
      entitiesStore.patch(BRANCH, { op: 'update', id: 'char_mira', columns: { name: 'Mira II' } })
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_flood', columns: { title: 'Ebb' } })
    })
    expect(view.renders).toBe(settled)
    act(() =>
      entitiesStore.patch(BRANCH, { op: 'update', id: 'char_kael', columns: { name: 'Kael II' } }),
    )
    expect(view.props?.rows[0]?.targetDisplayName).toBe('Relationship · Kael II')
    const renamed = view.renders
    expect(renamed).toBeGreaterThan(settled)
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Ashes' } }),
    )
    expect(view.props?.rows[1]?.targetDisplayName).toBe('Involvement · Ashes')
    expect(view.renders).toBeGreaterThan(renamed)
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
    await pastCoalescing()
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

  it('refetches once for a burst of link writes naming the row, as a classifier pass commits them', async () => {
    happeningAwarenessStore.hydrate(BRANCH, [])
    const load = loader(() => [])
    renderTab(load, 'char_aria')
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    for (let i = 0; i < 10; i += 1)
      await act(async () =>
        happeningAwarenessStore.patch(BRANCH, {
          op: 'create',
          id: `haw_${i}`,
          row: awareness(`haw_${i}`, 'char_aria'),
        }),
      )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
    await pastCoalescing()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
