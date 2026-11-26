// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { EntryIndexSnapshot } from '@/hooks/use-entry-index'
import { createQueryClient } from '@/lib/cache'
import type { CharacterRelationship, Delta, Happening, HappeningAwareness } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  createDiffCache,
  type DiffCache,
  type DiffCacheEntry,
  type DiffWalk,
  type HistoryChunk,
  type HistoryQuery,
  type HistoryRow,
  type HistoryTable,
} from '@/lib/history'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import {
  characterRelationshipsStore,
  entitiesStore,
  generationStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  happeningsStore,
} from '@/lib/stores'

import { DiffLoaderProvider, type DiffLoader } from './diff-loader'
import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { HistoryTab, REFRESH_COALESCE_MS } from './history-tab'
import type { HistoryTabViewProps } from './history-tab-view'

const view = vi.hoisted(() => ({
  props: null as HistoryTabViewProps | null,
  renders: 0,
  // Every summary any render showed, so a check can say one never appeared.
  summaries: new Set<string>(),
}))
vi.mock('./history-tab-view', () => ({
  HistoryTabView: (props: HistoryTabViewProps) => {
    view.props = props
    view.renders += 1
    for (const row of props.rows) view.summaries.add(row.summary)
    return null
  },
}))

// The real hook reads the app database, which a unit test has none of.
const entryIndex = vi.hoisted(() => ({
  entries: [],
  index: new Map(),
  ready: true,
  failed: false,
  updating: false,
  stale: false,
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

type TabOptions = {
  diffs?: DiffLoader
  client?: QueryClient
  onOpenEntry?: (entryId: string) => void
}

// A walk that never settles, so an update row keeps its field-name summary.
const unresolvedDiffs = (): DiffCache =>
  createDiffCache({ walk: () => new Promise<never>(() => {}) })

function renderTab(
  load: HistoryLoader,
  targetId: string,
  targetTable: HistoryTable = 'entities',
  {
    diffs = unresolvedDiffs(),
    client = createQueryClient(),
    onOpenEntry = () => {},
  }: TabOptions = {},
) {
  view.props = null
  view.renders = 0
  view.summaries.clear()
  // A fresh element tree on each call, so a rerender reaches the tab.
  const tree = () => (
    <QueryClientProvider client={client}>
      <HistoryLoaderProvider value={load}>
        <DiffLoaderProvider value={diffs}>
          <HistoryTab
            branchId={BRANCH}
            targetTable={targetTable}
            targetId={targetId}
            onOpenEntry={onOpenEntry}
          />
        </DiffLoaderProvider>
      </HistoryLoaderProvider>
    </QueryClientProvider>
  )
  const result = render(tree())
  return { ...result, rerenderTab: () => result.rerender(tree()) }
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
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'fire' }),
        expect.any(Function),
      ),
    )
    await firstRow()
    const searched = load.mock.calls.length
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Blaze' } }),
    )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(searched + 1))
    expect(load).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'fire', cursor: null }),
      expect.any(Function),
    )
  })

  it("refetches for an unshown link end's rename only while a search is set", async () => {
    happeningsStore.hydrate(BRANCH, [fire(BRANCH, 'Fire')])
    // A slow search read: its rows are [] while it loads as well as once it lands, and the link
    // ends it watches come only with its names.
    const load = vi.fn(async (query: HistoryQuery): Promise<HistoryChunk> => {
      if (query.search === 'blaze') await new Promise((resolve) => setTimeout(resolve, 50))
      return {
        rows: query.search === 'blaze' ? [] : [INVOLVES_FIRE],
        nextCursor: null,
        names: { hap_fire: 'Fire' },
      }
    })
    renderTab(load, 'char_aria')
    await firstRow()
    act(() => view.props?.onSearchChange('blaze'))
    await waitFor(() => expect(view.props).toMatchObject({ status: 'ready', rows: [] }))
    const searched = load.mock.calls.length
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Blaze' } }),
    )
    await waitFor(() => expect(load).toHaveBeenCalledTimes(searched + 1))

    act(() => view.props?.onSearchChange(''))
    await firstRow()
    const unfiltered = load.mock.calls.length
    act(() =>
      happeningsStore.patch(BRANCH, { op: 'update', id: 'hap_fire', columns: { title: 'Ember' } }),
    )
    await pastCoalescing()
    expect(load).toHaveBeenCalledTimes(unfiltered)
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
      expect.any(Function),
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

describe('HistoryTab entry links', () => {
  const anchored = (id: string, entryId: string): HistoryRow => ({
    delta: { ...VIEW_EDIT, id, entryId, targetTable: 'entities', targetId: 'char_aria' },
    via: { kind: 'own' },
  })

  beforeEach(() => {
    view.props = null
  })

  afterEach(() => {
    entryIndex.index.clear()
  })

  it('hands the view onOpenEntry, and a raw id only on a row whose anchor resolved', async () => {
    entryIndex.index.set('entry_live', {
      id: 'entry_live',
      position: 47,
      kind: 'ai_reply',
      chapterId: null,
      excerpt: '',
    })
    const onOpenEntry = vi.fn()
    renderTab(
      loader(() => [anchored('d_live', 'entry_live'), anchored('d_gone', 'entry_gone')]),
      'char_aria',
      'entities',
      { onOpenEntry },
    )
    await waitFor(() => expect(view.props?.rows).toHaveLength(2))
    expect(view.props?.onOpenEntry).toBe(onOpenEntry)
    expect(view.props?.rows.map((row) => row.entry)).toEqual([
      { label: 'entry #47', id: 'entry_live' },
      null,
    ])
  })
})

type WalkResult = Awaited<ReturnType<DiffWalk>>

function walked(entries: Record<string, DiffCacheEntry>, gone: readonly string[] = []): WalkResult {
  return { entries: new Map(Object.entries(entries)), gone: new Set(gone) }
}

const entry = (
  old: Record<string, unknown>,
  next: Record<string, unknown>,
  names: Record<string, string> = {},
): DiffCacheEntry => ({ old, new: next, names })

// TanStack notifies observers on a timer, so a "nothing changed" check waits past it.
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)))

const update = (
  id: string,
  targetTable: string,
  targetId: string,
  undoPayload: Record<string, unknown>,
  logPosition = 3,
): Delta => ({ ...VIEW_EDIT, id, targetTable, targetId, undoPayload, logPosition })

const own = (delta: Delta): HistoryRow => ({ delta, via: { kind: 'own' } })

const onAriasRelationship = (delta: Delta): HistoryRow => ({
  delta,
  via: {
    kind: 'link',
    table: 'character_relationships',
    linkId: delta.targetId,
    otherId: 'char_kael',
    side: 'a',
  },
})

const VOICE = update('delta_voice', 'entities', 'char_aria', { state: { voice: 'low' } })
const VOICE_ENTRY = entry(
  { state: { voice: 'low' } },
  { state: { voice: 'gravelly', traits: ['wary'] } },
)
const VOICE_PROSE = 'Voice: "low" → "gravelly"'
const HOARSE_ENTRY = entry({ state: { voice: 'low' } }, { state: { voice: 'hoarse' } })
const HOARSE_PROSE = 'Voice: "low" → "hoarse"'

const FACTION = update('delta_faction', 'entities', 'char_aria', { state: { faction_id: null } })
const FACTION_ENTRY = entry(
  { state: { faction_id: null } },
  { state: { faction_id: 'fac_iron', traits: [] } },
  { fac_iron: 'Iron Pact' },
)

const OCCURRED = update('delta_occurred', 'happenings', 'hap_fire', { occurredAtEntryId: null })
const OCCURRED_ENTRY = entry({ occurredAtEntryId: null }, { occurredAtEntryId: 'entry_12' })

type IndexState = Pick<EntryIndexSnapshot, 'ready' | 'failed' | 'updating' | 'stale'>
// The states `useEntryIndex` reports, its index empty until it has read.
const UNREAD: IndexState = { ready: false, failed: false, updating: false, stale: true }
const REREADING: IndexState = { ready: true, failed: false, updating: true, stale: true }
const REREAD_FAILED: IndexState = { ready: true, failed: false, updating: false, stale: true }
const CURRENT: IndexState = { ready: true, failed: false, updating: false, stale: false }

// A fresh map, so the tab sees a changed index as the hook hands one over.
function showIndex(state: IndexState, ...positions: number[]) {
  Object.assign(entryIndex, state)
  entryIndex.index = new Map(
    positions.map((position) => [
      `entry_${position}`,
      { id: `entry_${position}`, position, kind: 'ai_reply', chapterId: null, excerpt: '' },
    ]),
  )
}

// Occurred at: none → entry_12, its walk landed.
async function renderOccurred() {
  const client = createQueryClient()
  const walk = vi.fn<DiffWalk>().mockResolvedValue(walked({ [OCCURRED.id]: OCCURRED_ENTRY }))
  const tab = renderTab(
    loader(() => [own(OCCURRED)]),
    'hap_fire',
    'happenings',
    { diffs: createDiffCache({ walk }), client },
  )
  await waitFor(() =>
    expect(client.getQueryData(['diff', BRANCH, OCCURRED.id])).toEqual({
      kind: 'entry',
      entry: OCCURRED_ENTRY,
    }),
  )
  await settle()
  return tab
}

describe('HistoryTab change prose', () => {
  afterEach(() => {
    showIndex(CURRENT)
  })

  it('shows the field-name summary first, then the prose once the walk resolves', async () => {
    const walk = Promise.withResolvers<WalkResult>()
    const diffs = createDiffCache({ walk: () => walk.promise })
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs },
    )
    expect((await firstRow())?.summary).toBe('Modified Voice')
    await act(async () => walk.resolve(walked({ [VOICE.id]: VOICE_ENTRY })))
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE))
  })

  it("shows the prose under a client whose queries go stale at once, as TanStack's default does", async () => {
    const diffs = createDiffCache({ walk: async () => walked({ [VOICE.id]: VOICE_ENTRY }) })
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs, client: new QueryClient() },
    )
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE))
  })

  it('keeps the summary when the walk rejects, and when it finds the delta gone', async () => {
    const failedClient = createQueryClient()
    const failing = vi
      .fn<DiffWalk>()
      .mockRejectedValue(new Error('no row, head delete or held copy'))
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk: failing }), client: failedClient },
    )
    await waitFor(() =>
      expect(failedClient.getQueryState(['diff', BRANCH, VOICE.id])?.status).toBe('error'),
    )
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Voice')
    cleanup()

    const goneClient = createQueryClient()
    const gone = vi.fn<DiffWalk>().mockResolvedValue(walked({}, [VOICE.id]))
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk: gone }), client: goneClient },
    )
    await waitFor(() =>
      expect(goneClient.getQueryData(['diff', BRANCH, VOICE.id])).toEqual({ kind: 'gone' }),
    )
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Voice')
  })

  it('reads no diff for create, delete and removal rows', async () => {
    const walk = vi.fn<DiffWalk>(async (requested) =>
      walked(Object.fromEntries(requested.map((delta) => [delta.id, VOICE_ENTRY]))),
    )
    const diffs = createDiffCache({ walk })
    const populate = vi.spyOn(diffs, 'populate')
    const deleted: HistoryRow = {
      delta: { ...VIEW_EDIT, id: 'delta_rel_gone', op: 'delete', undoPayload: { id: 'rel_1' } },
      via: ON_ARIAS_TAB.via,
    }
    const removed: HistoryRow = {
      delta: {
        ...VIEW_EDIT,
        id: 'delta_kael_gone',
        targetTable: 'entities',
        targetId: 'char_kael',
        op: 'delete',
        undoPayload: { id: 'char_kael', name: 'Kael' },
      },
      via: { kind: 'removed', tables: ['character_relationships'], otherId: 'char_kael' },
    }
    renderTab(
      loader(() => [INVOLVES_FIRE, deleted, removed, own(VOICE)]),
      'char_aria',
      'entities',
      { diffs },
    )
    await waitFor(() => expect(view.props?.rows[3]?.summary).toBe(VOICE_PROSE))
    expect(populate.mock.calls.map(([delta]) => delta.id)).toEqual([VOICE.id])
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('walks once per target for a chunk of update rows', async () => {
    const rows = [
      own(update('delta_v1', 'entities', 'char_aria', { state: { voice: 'low' } }, 3)),
      own(update('delta_v2', 'entities', 'char_aria', { description: 'old' }, 4)),
      onAriasRelationship(
        update('delta_k1', 'character_relationships', 'rel_1', { kind: 'ally' }, 5),
      ),
      onAriasRelationship(
        update('delta_k2', 'character_relationships', 'rel_1', { inverseKind: 'rival' }, 6),
      ),
    ]
    const walk = vi.fn<DiffWalk>(async (requested) =>
      walked(Object.fromEntries(requested.map((delta) => [delta.id, entry({}, {})]))),
    )
    renderTab(
      loader(() => rows),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk }) },
    )
    await waitFor(() => expect(walk).toHaveBeenCalledTimes(2))
    await settle()
    expect(walk).toHaveBeenCalledTimes(2)
    expect(
      walk.mock.calls.map(([requested]) => requested.map((delta) => delta.id).sort()).sort(),
    ).toEqual([
      ['delta_k1', 'delta_k2'],
      ['delta_v1', 'delta_v2'],
    ])
  })

  it("re-reads a mounted row when the cache evicts the tab's branch, and only then", async () => {
    const rewalk = Promise.withResolvers<WalkResult>()
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValueOnce(walked({ [VOICE.id]: VOICE_ENTRY }))
      .mockReturnValueOnce(rewalk.promise)
    const diffs = createDiffCache({ walk })
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs },
    )
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE))

    const populate = vi.spyOn(diffs, 'populate')
    act(() => diffs.evictBranch('br_other'))
    await settle()
    expect(populate).not.toHaveBeenCalled()
    expect(walk).toHaveBeenCalledTimes(1)
    expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE)

    act(() => diffs.evictBranch(BRANCH))
    await waitFor(() => expect(walk).toHaveBeenCalledTimes(2))
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Voice')

    await act(async () => rewalk.resolve(walked({ [VOICE.id]: HOARSE_ENTRY })))
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(HOARSE_PROSE))
    expect(walk).toHaveBeenCalledTimes(2)
  })

  it('falls back to the summary when the re-read after an eviction fails', async () => {
    const client = createQueryClient()
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValueOnce(walked({ [VOICE.id]: VOICE_ENTRY }))
      .mockRejectedValueOnce(new Error('no row, head delete or held copy'))
    const diffs = createDiffCache({ walk })
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs, client },
    )
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE))

    act(() => diffs.evictBranch(BRANCH))
    await waitFor(() =>
      expect(client.getQueryState(['diff', BRANCH, VOICE.id])?.status).toBe('error'),
    )
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Voice')
  })

  it('ends on the walk after an eviction that lands while the first walk is pending', async () => {
    const stale = Promise.withResolvers<WalkResult>()
    const walk = vi
      .fn<DiffWalk>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(walked({ [VOICE.id]: HOARSE_ENTRY }))
    const diffs = createDiffCache({ walk })
    renderTab(
      loader(() => [own(VOICE)]),
      'char_aria',
      'entities',
      { diffs },
    )
    await waitFor(() => expect(walk).toHaveBeenCalledTimes(1))

    act(() => diffs.evictBranch(BRANCH))
    await act(async () => stale.resolve(walked({ [VOICE.id]: VOICE_ENTRY })))
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(HOARSE_PROSE))
    expect(walk).toHaveBeenCalledTimes(2)
    expect(view.summaries).not.toContain(VOICE_PROSE)
  })

  it('reads again on a remount after an eviction the unmounted tab did not hear', async () => {
    const client = createQueryClient()
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValueOnce(walked({ [VOICE.id]: VOICE_ENTRY }))
      .mockResolvedValueOnce(walked({ [VOICE.id]: HOARSE_ENTRY }))
    const diffs = createDiffCache({ walk })
    const load = loader(() => [own(VOICE)])
    renderTab(load, 'char_aria', 'entities', { diffs, client })
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(VOICE_PROSE))

    cleanup()
    act(() => diffs.evictBranch(BRANCH))
    // Past the unmounted query's gc, well inside the client's 30 s default.
    await settle()
    renderTab(load, 'char_aria', 'entities', { diffs, client })
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe(HOARSE_PROSE))
    expect(walk).toHaveBeenCalledTimes(2)
  })

  it('renames a ref in the prose from the working set, without walking again', async () => {
    act(() =>
      entitiesStore.patch(BRANCH, {
        op: 'create',
        id: 'fac_iron',
        row: makeEntity({ id: 'fac_iron', kind: 'faction', name: 'Iron Pact' }),
      }),
    )
    const walk = vi.fn<DiffWalk>().mockResolvedValue(walked({ [FACTION.id]: FACTION_ENTRY }))
    renderTab(
      loader(() => [own(FACTION)]),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk }) },
    )
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Faction: none → Iron Pact'))

    act(() =>
      entitiesStore.patch(BRANCH, {
        op: 'update',
        id: 'fac_iron',
        columns: { name: 'Iron Pact Reborn' },
      }),
    )
    await waitFor(() =>
      expect(view.props?.rows[0]?.summary).toBe('Faction: none → Iron Pact Reborn'),
    )
    expect(walk).toHaveBeenCalledTimes(1)
  })

  it('marks a ref (deleted) when the working set holds its id only on another branch', async () => {
    entitiesStore.hydrate('br_other', [
      makeEntity({ id: 'fac_iron', branchId: 'br_other', kind: 'faction', name: 'Iron Pact' }),
    ])
    const walk = vi.fn<DiffWalk>().mockResolvedValue(walked({ [FACTION.id]: FACTION_ENTRY }))
    renderTab(
      loader(() => [own(FACTION)]),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk }) },
    )
    await waitFor(() =>
      expect(view.props?.rows[0]?.summary).toBe('Faction: none → Iron Pact (deleted)'),
    )
  })

  it('holds an entry-ref row on its summary until the entry index has read, and after a failed re-read that lacks its entry', async () => {
    showIndex(UNREAD)
    const tab = await renderOccurred()
    expect(view.props?.rows[0]?.summary).toBe('Modified Occurred at')

    showIndex(REREAD_FAILED, 11)
    tab.rerenderTab()
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Occurred at')

    showIndex(CURRENT, 12, 11)
    tab.rerenderTab()
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Occurred at: none → entry #12'))
  })

  it('keeps the prose of a row whose entry the index holds while the index re-reads', async () => {
    showIndex(REREADING, 12, 11)
    await renderOccurred()
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Occurred at: none → entry #12'))
  })

  it('holds a row naming an entry the index lacks on its summary while the index re-reads', async () => {
    showIndex(REREADING, 11)
    await renderOccurred()
    expect(view.props?.rows[0]?.summary).toBe('Modified Occurred at')
    expect([...view.summaries]).toEqual(['Modified Occurred at'])
  })

  it('reads Unknown entry for an entry the index lacks once the index is current', async () => {
    showIndex(CURRENT, 11)
    await renderOccurred()
    await waitFor(() =>
      expect(view.props?.rows[0]?.summary).toBe('Occurred at: none → Unknown entry'),
    )
  })

  it("holds a link row's entry ref on its summary until the entry index has read", async () => {
    showIndex(UNREAD)
    const learned = update('delta_learned', 'happening_awareness', 'haw_1', {
      learnedAtEntryId: null,
    })
    const learnedEntry = entry({ learnedAtEntryId: null }, { learnedAtEntryId: 'entry_12' })
    const client = createQueryClient()
    const walk = vi.fn<DiffWalk>().mockResolvedValue(walked({ [learned.id]: learnedEntry }))
    const tab = renderTab(
      loader((): HistoryRow[] => [
        {
          delta: learned,
          via: {
            kind: 'link',
            table: 'happening_awareness',
            linkId: 'haw_1',
            otherId: 'hap_fire',
            side: null,
          },
        },
      ]),
      'char_aria',
      'entities',
      { diffs: createDiffCache({ walk }), client },
    )
    await waitFor(() =>
      expect(client.getQueryData(['diff', BRANCH, learned.id])).toEqual({
        kind: 'entry',
        entry: learnedEntry,
      }),
    )
    await settle()
    expect(view.props?.rows[0]?.summary).toBe('Modified Learned at')

    showIndex(CURRENT, 12)
    tab.rerenderTab()
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Learned at: none → entry #12'))
  })

  describe('a value of the wrong type', () => {
    const NAMED = update('delta_named', 'entities', 'char_aria', {
      description: 'old',
      name: 'Kael',
    })

    async function renderWalked(delta: Delta, walkedEntry: DiffCacheEntry, diffs: DiffCache) {
      const client = createQueryClient()
      const tab = renderTab(
        loader(() => [own(delta)]),
        'char_aria',
        'entities',
        { diffs, client },
      )
      await waitFor(() =>
        expect(client.getQueryData(['diff', BRANCH, delta.id])).toEqual({
          kind: 'entry',
          entry: walkedEntry,
        }),
      )
      await settle()
      return tab
    }

    let warn: MockInstance<typeof logger.warn>
    beforeEach(() => {
      warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    })
    afterEach(() => {
      warn.mockRestore()
    })

    const mistypedWarns = () =>
      warn.mock.calls.filter(([kind]) => kind === 'history.diff_prose_mistyped')

    it('keeps the summary and warns once for the row, through a re-render and a remount', async () => {
      const named = entry({ description: 'old', name: 'Kael' }, { description: 'new', name: 7 })
      const diffs = createDiffCache({ walk: async () => walked({ [NAMED.id]: named }) })
      const tab = await renderWalked(NAMED, named, diffs)
      expect(view.props?.rows[0]?.summary).toBe('Modified Description, Name')
      expect(mistypedWarns()).toEqual([
        ['history.diff_prose_mistyped', { branchId: BRANCH, deltaId: NAMED.id, path: 'name' }],
      ])

      // A fresh index re-derives every row.
      showIndex(CURRENT, 3)
      const renders = view.renders
      tab.rerenderTab()
      await settle()
      expect(view.renders).toBeGreaterThan(renders)
      expect(mistypedWarns()).toHaveLength(1)
      cleanup()
      await renderWalked(NAMED, named, diffs)
      expect(view.props?.rows[0]?.summary).toBe('Modified Description, Name')
      expect(mistypedWarns()).toHaveLength(1)
    })

    it('warns for nothing on a row whose path has no wording', async () => {
      const bogus = update('delta_bogus', 'entities', 'char_aria', { bogus: 'x' })
      const unworded = entry({ bogus: 'x' }, { bogus: 'y' })
      await renderWalked(
        bogus,
        unworded,
        createDiffCache({ walk: async () => walked({ [bogus.id]: unworded }) }),
      )
      expect(view.props?.rows[0]?.summary).toBe('Modified bogus')
      expect(mistypedWarns()).toEqual([])
    })
  })

  it("reads a relationship row's prose by the tab's side", async () => {
    const kind = update('delta_kind', 'character_relationships', 'rel_1', { kind: 'rival' })
    const walk = vi
      .fn<DiffWalk>()
      .mockResolvedValue(walked({ [kind.id]: entry({ kind: 'rival' }, { kind: 'ally' }) }))
    const diffs = createDiffCache({ walk })
    const load = loader((query): HistoryRow[] => [
      {
        delta: kind,
        via: {
          kind: 'link',
          table: 'character_relationships',
          linkId: 'rel_1',
          otherId: query.targetId === 'char_aria' ? 'char_kael' : 'char_aria',
          side: query.targetId === 'char_aria' ? 'a' : 'b',
        },
      },
    ])
    renderTab(load, 'char_aria', 'entities', { diffs })
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Your view: "rival" → "ally"'))
    cleanup()
    renderTab(load, 'char_kael', 'entities', { diffs })
    await waitFor(() => expect(view.props?.rows[0]?.summary).toBe('Their view: "rival" → "ally"'))
    // The second tab reads the cached entry through `peek`: prose from its first render, no walk.
    expect(walk).toHaveBeenCalledTimes(1)
    expect([...view.summaries]).toEqual(['Their view: "rival" → "ally"'])
  })
})
