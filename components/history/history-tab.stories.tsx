import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { EntryIndexReadProvider, type EntryIndexRead } from '@/hooks/use-entry-index'
import { registerAllDomains } from '@/lib/actions'
import type { Delta, Entity, Happening, Thread } from '@/lib/db'
import type { EntryRef } from '@/lib/entry-refs'
import type {
  DiffCacheEntry,
  DiffOutcome,
  HistoryChunk,
  HistoryQuery,
  HistoryRow,
  HistoryTable,
} from '@/lib/history'
import { entitiesStore, generationStore, happeningsStore, threadsStore } from '@/lib/stores'

import { DiffLoaderProvider, type DiffLoader } from './diff-loader'
import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { HistoryTab } from './history-tab'

// Storybook registers no domains; term-list prose reads each list's registered match.
registerAllDomains()

const delta = (
  targetTable: string,
  targetId: string,
  undoPayload: Record<string, unknown>,
): Delta => ({
  id: `delta_${targetId}`,
  branchId: 'br_1',
  entryId: null,
  actionId: 'act_1',
  logPosition: 1,
  source: 'periodic_classifier',
  targetTable,
  targetId,
  op: 'update',
  undoPayload,
  encodingVersion: 1,
  createdAt: Date.now() - 60_000,
})

const own = (row: Delta): HistoryRow => ({ delta: row, via: { kind: 'own' } })

const WAIT = { timeout: 3000 }

const queries: HistoryQuery[] = []

// A filtered query matches nothing, so the no-match state is reachable.
const load = async (query: HistoryQuery): Promise<HistoryChunk> => {
  queries.push(query)
  if (query.op != null || (query.search ?? '') !== '')
    return { rows: [], nextCursor: null, names: {} }
  return {
    rows: [
      own(
        query.targetTable === 'threads'
          ? delta('threads', 'thread_amulet', { status: 'pending' })
          : delta('happenings', 'hap_fire', { commonKnowledge: 0 }),
      ),
    ],
    nextCursor: null,
    names: {},
  }
}

function hydrateTargets(): () => void {
  threadsStore.hydrate('br_1', [
    {
      id: 'thread_amulet',
      branchId: 'br_1',
      title: 'What the amulet wants',
      description: null,
      category: null,
      icon: null,
      status: 'active',
      injectionMode: 'auto',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Thread,
  ])
  happeningsStore.hydrate('br_1', [
    {
      id: 'hap_fire',
      branchId: 'br_1',
      title: 'The keep burns',
      description: null,
      category: null,
      icon: null,
      temporal: null,
      occurredAtEntryId: null,
      commonKnowledge: 1,
      embeddingStale: 0,
      createdAt: 1,
      updatedAt: 1,
    } satisfies Happening,
  ])
  return () => {
    threadsStore.__reset()
    happeningsStore.__reset()
    generationStore.__reset()
  }
}

// Newest first, as readEntryIndex returns them: the entries the prose stories name.
const ENTRIES: readonly EntryRef[] = [47, 40, 31, 12, 3].map(
  (position): EntryRef => ({
    id: `entry_${position}`,
    position,
    kind: 'ai_reply',
    chapterId: null,
    excerpt: '',
  }),
)
const readEntries: EntryIndexRead = async () => ENTRIES

const NO_EVICTIONS = () => () => {}

// The default for every story: a walk that never settles, so update rows keep their summary.
const PENDING_DIFFS: DiffLoader = {
  peek: () => undefined,
  populate: () => new Promise<DiffOutcome>(() => {}),
  onEvict: NO_EVICTIONS,
  isCurrent: () => true,
}

const meta: Meta<typeof HistoryTab> = {
  title: 'Compounds/History/HistoryTab',
  component: HistoryTab,
  parameters: { layout: 'padded' },
  // Per story, with cleanup, so the hydrated rows can't leak into another file's stories.
  beforeEach: () => {
    queries.length = 0
    return hydrateTargets()
  },
  decorators: [
    (Story) => (
      <EntryIndexReadProvider value={readEntries}>
        <HistoryLoaderProvider value={load}>
          <DiffLoaderProvider value={PENDING_DIFFS}>
            <Story />
          </DiffLoaderProvider>
        </HistoryLoaderProvider>
      </EntryIndexReadProvider>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof HistoryTab>

export const ThreadRow: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row')
    expect(within(row).getByText('What the amulet wants')).toBeVisible()
    expect(within(row).getByText('Modified Status')).toBeVisible()
  },
}

export const HappeningRow: Story = {
  args: { branchId: 'br_1', targetTable: 'happenings', targetId: 'hap_fire' },
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row')
    expect(within(row).getByText('The keep burns')).toBeVisible()
    expect(within(row).getByText('Modified Common knowledge')).toBeVisible()
  },
}

/** The op chip and the debounced search both reach the query, each from the first chunk. */
export const FiltersReachTheQuery: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(queries.at(-1)).toMatchObject({ op: 'delete', cursor: null }), WAIT)
    expect(await screen.findByText('No changes match', {}, WAIT)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'All' }))
    await userEvent.type(screen.getByPlaceholderText('Search fields, changes…'), 'status')
    await waitFor(
      () => expect(queries.at(-1)).toMatchObject({ search: 'status', cursor: null }),
      WAIT,
    )
    expect(queries.at(-1)?.op).toBeUndefined()
  },
}

/** Clearing a no-match search keeps "No changes match" until the unfiltered log arrives. */
export const ClearingASearch: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  play: async () => {
    const input = await screen.findByPlaceholderText('Search fields, changes…', {}, WAIT)
    await userEvent.type(input, 'zzz')
    expect(await screen.findByText('No changes match', {}, WAIT)).toBeVisible()

    // The wrong empty state may render for as little as one commit, so read every mutation record.
    let sawEmpty = false
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const texts = Array.from(record.addedNodes, (node) => node.textContent ?? '')
        if (record.type === 'characterData') texts.push(record.target.textContent ?? '')
        if (texts.some((text) => text.includes('No history yet'))) sawEmpty = true
      }
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    await userEvent.clear(input)
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    observer.disconnect()
    expect(sawEmpty).toBe(false)
  },
}

function SwitchTargetHarness() {
  const [target, setTarget] = useState<{ targetTable: HistoryTable; targetId: string }>({
    targetTable: 'threads',
    targetId: 'thread_amulet',
  })
  return (
    <View className="gap-3">
      <Button
        variant="secondary"
        size="sm"
        onPress={() => setTarget({ targetTable: 'happenings', targetId: 'hap_fire' })}
      >
        <Text>Switch to the happening</Text>
      </Button>
      <HistoryTab
        branchId="br_1"
        targetTable={target.targetTable}
        targetId={target.targetId}
        onOpenEntry={() => {}}
      />
    </View>
  )
}

/** A target switch on the same mounted host drops the prior row's search and op filter. */
export const SwitchingTargetsResetsFilters: Story = {
  render: () => <SwitchTargetHarness />,
  play: async () => {
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await userEvent.type(screen.getByPlaceholderText('Search fields, changes…'), 'status')
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }))
    await waitFor(() => expect(screen.getByText('No changes match')).toBeVisible(), WAIT)

    await userEvent.click(screen.getByRole('button', { name: 'Switch to the happening' }))
    await waitFor(
      () => expect(screen.getByPlaceholderText('Search fields, changes…')).toHaveValue(''),
      WAIT,
    )
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Deleted' })).toHaveAttribute('aria-pressed', 'false')
    const [row] = await screen.findAllByTestId('delta-log-row', {}, WAIT)
    expect(within(row).getByText('The keep burns')).toBeVisible()
  },
}

const reloadSpy = fn(
  async (_query: HistoryQuery): Promise<HistoryChunk> => ({
    rows: [own(delta('threads', 'thread_amulet', { status: 'pending' }))],
    nextCursor: null,
    names: {},
  }),
)

/** `version` gets a fresh identity — and the log reloads from `cursor: null` — on a same-row
 * patch or a run/reversal settle, not just on mount. */
export const ReloadsOnRowPatchAndRunSettle: Story = {
  args: { branchId: 'br_1', targetTable: 'threads', targetId: 'thread_amulet' },
  // The play counts calls from mount; a re-run or CI retry must start at zero.
  beforeEach: () => {
    reloadSpy.mockClear()
  },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={reloadSpy}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1), WAIT)
    expect(reloadSpy.mock.calls[0][0]).toEqual(expect.objectContaining({ cursor: null }))

    threadsStore.patch('br_1', {
      op: 'update',
      id: 'thread_amulet',
      columns: { title: 'What the amulet truly wants' },
    })
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(2), WAIT)
    expect(reloadSpy.mock.calls[1][0]).toEqual(expect.objectContaining({ cursor: null }))

    const runId = 'run_settle_test'
    generationStore.startRun({
      runId,
      kind: 'test_run',
      gateBehavior: 'hard-gate',
      interruptible: null,
      beforeTurn: false,
      actionId: 'act_settle',
      storyId: null,
      branchId: 'br_1',
      abortController: new AbortController(),
      currentPhase: 'test',
      intermediates: {},
      terminal: Promise.resolve(),
      resolveTerminal: () => {},
    })
    generationStore.finishRun(runId)
    await waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(3), WAIT)
    expect(reloadSpy.mock.calls[2][0]).toEqual(expect.objectContaining({ cursor: null }))
  },
}

const KAEL: Entity = {
  id: 'char_kael',
  branchId: 'br_1',
  kind: 'character',
  name: 'Kael',
  description: null,
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
  state: null,
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 1,
  createdAt: 1,
  updatedAt: 1,
}

const awarenessCreate = (linkId: string, characterId: string): HistoryRow => ({
  delta: { ...delta('happening_awareness', linkId, {}), op: 'create', undoPayload: null },
  via: {
    kind: 'link',
    table: 'happening_awareness',
    linkId,
    otherId: characterId,
    side: null,
  },
})

const linkRowsLoad = async (): Promise<HistoryChunk> => ({
  rows: [awarenessCreate('haw_kael', 'char_kael'), awarenessCreate('haw_mira', 'char_mira')],
  nextCursor: null,
  // Kael's chunk name is stale: the working set's must win. Mira is in the chunk only.
  names: { char_kael: 'Kael (as deleted)', char_mira: 'Mira' },
})

/** The other end of a link row reads from the working set, else from the chunk's `names`. */
export const NamesLinkRowsByOtherEnd: Story = {
  args: { branchId: 'br_1', targetTable: 'happenings', targetId: 'hap_fire' },
  beforeEach: () => {
    entitiesStore.hydrate('br_1', [KAEL])
    return () => entitiesStore.__reset()
  },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={linkRowsLoad}>
        <Story />
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    const rows = await screen.findAllByTestId('delta-log-row', {}, WAIT)
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Awareness · Kael')).toBeVisible()
    expect(within(rows[1]).getByText('Awareness · Mira')).toBeVisible()
  },
}

// ---- Change prose (world.md): one update row whose diff resolves, stays pending or fails ----

const oneRow =
  (row: HistoryRow): HistoryLoader =>
  async () => ({ rows: [row], nextCursor: null, names: {} })

function resolvingDiffs(entry: DiffCacheEntry): DiffLoader {
  return {
    peek: () => undefined,
    populate: async () => ({ kind: 'entry', entry }),
    onEvict: NO_EVICTIONS,
    isCurrent: () => true,
  }
}

const entity = (id: string, kind: Entity['kind'], name: string): Entity => ({
  ...KAEL,
  id,
  kind,
  name,
})

type ProseFixture = {
  targetTable: HistoryTable
  targetId: string
  row: HistoryRow
  entry: DiffCacheEntry
  /** The summary world.md → Change prose gives this row, in en. */
  prose: string
  /** Entities hydrated on br_1: an entity target, and the other end or refs the row names. */
  entities?: Entity[]
}

function proseStory({
  targetTable,
  targetId,
  row,
  entry,
  prose,
  entities = [],
}: ProseFixture): Story {
  const rows = oneRow(row)
  const diffs = resolvingDiffs(entry)
  return {
    args: { branchId: 'br_1', targetTable, targetId },
    beforeEach: () => {
      entitiesStore.hydrate('br_1', entities)
      return () => entitiesStore.__reset()
    },
    decorators: [
      (Story) => (
        <HistoryLoaderProvider value={rows}>
          <DiffLoaderProvider value={diffs}>
            <Story />
          </DiffLoaderProvider>
        </HistoryLoaderProvider>
      ),
    ],
    play: async () => {
      const [historyRow] = await screen.findAllByTestId('delta-log-row', {}, WAIT)
      expect(await within(historyRow).findByText(prose, {}, WAIT)).toBeVisible()
    },
  }
}

const kaelUpdate = (undoPayload: Record<string, unknown>) =>
  own(delta('entities', 'char_kael', undoPayload))

/** Free text: quoted, and a long side cut by world.md → Long text — change prose. */
export const ProseFreeText: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ description: 'A wary ranger.' }),
  entry: {
    old: { description: 'A wary ranger.' },
    new: { description: 'A wary ranger. He once served the crown before the war.' },
    names: {},
  },
  prose: 'Description: "A wary ranger." → "A wary ranger. He once served the crown…"',
  entities: [KAEL],
})

/** Enum: the select's word. */
export const ProseEnum: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ status: 'active' }),
  entry: { old: { status: 'active' }, new: { status: 'retired' }, names: {} },
  prose: 'Status: Active → Retired',
  entities: [KAEL],
})

/** Number: as stored. */
export const ProseNumber: Story = proseStory({
  targetTable: 'lore',
  targetId: 'lore_pact',
  row: own(delta('lore', 'lore_pact', { priority: 0 })),
  entry: { old: { priority: 0 }, new: { priority: 5 }, names: {} },
  prose: 'Priority: 0 → 5',
})

/** Flag: yes and no. */
export const ProseFlag: Story = proseStory({
  targetTable: 'happenings',
  targetId: 'hap_fire',
  row: own(delta('happenings', 'hap_fire', { commonKnowledge: 0 })),
  entry: { old: { commonKnowledge: 0 }, new: { commonKnowledge: 1 }, names: {} },
  prose: 'Common knowledge: no → yes',
})

/** Row ref: a merge's deleted loser reads (deleted), its live namesake doesn't. */
export const ProseRowRef: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ state: { faction_id: 'fac_old' } }),
  entry: {
    old: { state: { faction_id: 'fac_old' } },
    new: { state: { faction_id: 'fac_iron', traits: ['wary'] } },
    names: { fac_old: 'Iron Pact', fac_iron: 'Iron Pact' },
  },
  prose: 'Faction: Iron Pact (deleted) → Iron Pact',
  entities: [KAEL, entity('fac_iron', 'faction', 'Iron Pact')],
})

/** Entry ref: `entry #n` once the branch's entry index has read. */
export const ProseEntryRef: Story = proseStory({
  targetTable: 'threads',
  targetId: 'thread_amulet',
  row: own(delta('threads', 'thread_amulet', { resolvedAtEntryId: null })),
  entry: { old: { resolvedAtEntryId: null }, new: { resolvedAtEntryId: 'entry_31' }, names: {} },
  prose: 'Resolved at: none → entry #31',
})

/** Term list: added in the new list's order, removed in the old's; drives and voice say nothing. */
export const ProseTermList: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ state: { traits: ['loyal'] } }),
  entry: {
    old: { state: { traits: ['loyal'] } },
    new: {
      state: { traits: ['former soldier', 'scarred'], drives: ['find the amulet'], voice: 'low' },
    },
    names: {},
  },
  prose: 'Traits: added "former soldier", "scarred", removed "loyal"',
  entities: [KAEL],
})

/** Ref list: names in place of quoted terms. */
export const ProseRefList: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ state: { inventory: ['item_rope'] } }),
  entry: {
    old: { state: { inventory: ['item_rope'] } },
    new: { state: { inventory: ['item_silver'] } },
    names: { item_rope: 'Rope', item_silver: 'Silver coin' },
  },
  prose: 'Carried: added Silver coin, removed Rope (deleted)',
  entities: [KAEL, entity('item_silver', 'item', 'Silver coin')],
})

/** Record: keys from the old partial; a key added since reads none. */
export const ProseRecord: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({ state: { stackables: { gold: 250, arrows: null } } }),
  entry: {
    old: { state: { stackables: { gold: 250, arrows: null } } },
    new: { state: { stackables: { gold: 200, arrows: 12 } } },
    names: {},
  },
  prose: 'Quantities: gold 250 → 200, arrows none → 12',
  entities: [KAEL],
})

/** Compound: entry and place; world time doesn't show. */
export const ProseLastSeen: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: kaelUpdate({
    state: { lastSeenAt: { entryId: 'entry_40', locationId: 'loc_tavern', worldTime: 100 } },
  }),
  entry: {
    old: {
      state: { lastSeenAt: { entryId: 'entry_40', locationId: 'loc_tavern', worldTime: 100 } },
    },
    new: {
      state: { lastSeenAt: { entryId: 'entry_47', locationId: 'loc_market', worldTime: 141 } },
    },
    names: { loc_tavern: 'The Tavern', loc_market: 'Market Square' },
  },
  prose: 'Last seen: entry #40 at The Tavern → entry #47 at Market Square',
  entities: [
    KAEL,
    entity('loc_tavern', 'location', 'The Tavern'),
    entity('loc_market', 'location', 'Market Square'),
  ],
})

/** Placement group: an unplaced place reads Unknown, the parent picker's word. */
export const ProsePlacement: Story = proseStory({
  targetTable: 'entities',
  targetId: 'loc_alley',
  row: own(delta('entities', 'loc_alley', { state: { parent_location_id: null, unplaced: true } })),
  entry: {
    old: { state: { parent_location_id: null, unplaced: true } },
    new: { state: { parent_location_id: 'loc_quarter' } },
    names: { loc_quarter: 'The Old Quarter' },
  },
  prose: 'Parent location: Unknown → The Old Quarter',
  entities: [
    entity('loc_alley', 'location', 'The Alley'),
    entity('loc_quarter', 'location', 'The Old Quarter'),
  ],
})

/** Collision group: the partner's name when raised. */
export const ProseCollision: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael_twin',
  row: own(
    delta('entities', 'char_kael_twin', {
      nameCollisionFlag: 0,
      nameCollisionPartnerId: null,
      nameCollisionReason: null,
    }),
  ),
  entry: {
    old: { nameCollisionFlag: 0, nameCollisionPartnerId: null, nameCollisionReason: null },
    new: {
      nameCollisionFlag: 1,
      nameCollisionPartnerId: 'char_kael',
      nameCollisionReason: 'name-taken',
    },
    names: { char_kael: 'Kael' },
  },
  prose: 'Collision flag: none → Kael',
  entities: [KAEL, entity('char_kael_twin', 'character', 'Kael')],
})

const relationshipRow = (side: 'a' | 'b', otherId: string): HistoryRow => ({
  delta: delta('character_relationships', 'rel_aria_kael', { kind: 'rival' }),
  via: {
    kind: 'link',
    table: 'character_relationships',
    linkId: 'rel_aria_kael',
    otherId,
    side,
  },
})

const VIEW_CHANGE: DiffCacheEntry = {
  old: { kind: 'rival' },
  new: { kind: 'ally', inverseKind: null },
  names: {},
}

/** A relationship's `kind` is the tab's own view on side a… */
export const ProseRelationshipSideA: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_aria',
  row: relationshipRow('a', 'char_kael'),
  entry: VIEW_CHANGE,
  prose: 'Your view: "rival" → "ally"',
  entities: [KAEL, entity('char_aria', 'character', 'Aria')],
})

/** …and the other's view on side b. */
export const ProseRelationshipSideB: Story = proseStory({
  targetTable: 'entities',
  targetId: 'char_kael',
  row: relationshipRow('b', 'char_aria'),
  entry: VIEW_CHANGE,
  prose: 'Their view: "rival" → "ally"',
  entities: [KAEL, entity('char_aria', 'character', 'Aria')],
})

const VOICE_ROWS = oneRow(kaelUpdate({ state: { voice: 'low' } }))

const pendingPopulate = fn((_delta: Delta) => new Promise<DiffOutcome>(() => {}))
const PENDING_SPY: DiffLoader = {
  peek: () => undefined,
  populate: pendingPopulate,
  onEvict: NO_EVICTIONS,
  isCurrent: () => true,
}

/** A miss whose walk is still running shows the field-name summary. */
export const ProsePendingMiss: Story = {
  args: { branchId: 'br_1', targetTable: 'entities', targetId: 'char_kael' },
  beforeEach: () => {
    pendingPopulate.mockClear()
  },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={VOICE_ROWS}>
        <DiffLoaderProvider value={PENDING_SPY}>
          <Story />
        </DiffLoaderProvider>
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await waitFor(() => expect(pendingPopulate).toHaveBeenCalled(), WAIT)
    expect(within(row).getByText('Modified Voice')).toBeVisible()
  },
}

const failingPopulate = fn(async (_delta: Delta): Promise<DiffOutcome> => {
  throw new Error('no row, head delete or held copy')
})
const FAILING_SPY: DiffLoader = {
  peek: () => undefined,
  populate: failingPopulate,
  onEvict: NO_EVICTIONS,
  isCurrent: () => true,
}

/** A failed walk keeps the field-name summary. */
export const ProseFailedWalk: Story = {
  args: { branchId: 'br_1', targetTable: 'entities', targetId: 'char_kael' },
  beforeEach: () => {
    failingPopulate.mockClear()
  },
  decorators: [
    (Story) => (
      <HistoryLoaderProvider value={VOICE_ROWS}>
        <DiffLoaderProvider value={FAILING_SPY}>
          <Story />
        </DiffLoaderProvider>
      </HistoryLoaderProvider>
    ),
  ],
  play: async () => {
    const [row] = await screen.findAllByTestId('delta-log-row', {}, WAIT)
    await waitFor(() => expect(failingPopulate).toHaveBeenCalled(), WAIT)
    await expect(failingPopulate.mock.results[0].value).rejects.toThrow(
      'no row, head delete or held copy',
    )
    // Failed reads as pending does, so no wait here could show the error reached the row.
    expect(within(row).getByText('Modified Voice')).toBeVisible()
  },
}
