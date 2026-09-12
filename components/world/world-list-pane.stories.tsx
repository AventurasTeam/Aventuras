import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { ImporterMenu } from '@/components/compounds/importer-menu'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import type { RowSignalsSnapshot } from '@/hooks/use-row-signals'
import { emptyEntityState, type Entity, type Lore } from '@/lib/db'
import type { EntityFilter, WorldCategory } from '@/lib/list-modules'
import { worldListStore } from '@/lib/stores'

import { deriveCollisions } from './collisions'
import { worldAddOptions } from './world-add-options'
import { WorldListPane, type WorldListPaneHandle } from './world-list-pane'
import { worldAddLabel } from './world-selection'

function entity(
  id: string,
  kind: Entity['kind'],
  name: string,
  overrides: Partial<Entity> = {},
): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
    name,
    description: `${name} — a seeded ${kind}.`,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

const ENTITIES: Entity[] = [
  entity('char_kael', 'character', 'Kael', {
    state: { ...emptyEntityState('character'), visual: { hair: 'dark' }, traits: ['resourceful'] },
  }),
  entity('char_mira', 'character', 'Mira'),
  entity('char_vorne', 'character', 'Vorne', {
    status: 'retired',
    retiredReason: 'fled the Hollow',
  }),
  entity('char_sage', 'character', 'The Ashen Sage', { status: 'staged' }),
  entity('char_brannoc', 'character', 'Brannoc', { status: 'staged', createdAt: 1 }),
  entity('char_brannoc_2', 'character', 'Brannoc', { nameCollisionFlag: 1, createdAt: 2 }),
  entity('loc_hollow', 'location', "Veil's Hollow"),
  entity('loc_market', 'location', 'Night Market'),
  entity('item_blade', 'item', 'Courier blade'),
  entity('fac_watch', 'faction', 'The Watch'),
]

// Sort ahead of Brannoc within their tier, pushing its row past the 600px harness
// fold; their descriptions name him, so a search for Brannoc keeps them listed.
function fillerRows(status: Entity['status'], kind: Entity['kind'] = 'character'): Entity[] {
  return Array.from({ length: 25 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0')
    return entity(`${kind}_aa_${n}`, kind, `Aa ${n}`, {
      status,
      description: `Aa ${n} — in Brannoc's debt.`,
    })
  })
}

// Both kinds overflow the harness, so the browser can't clamp a carried-over offset to 0.
const LONG_LISTS: Entity[] = [
  ...ENTITIES,
  ...fillerRows('active'),
  ...fillerRows('active', 'location'),
]

const LORE: Lore[] = [
  {
    id: 'lore_veil',
    branchId: 'br_1',
    title: 'The Veil',
    body: 'A membrane between the city and what it was built to contain.',
    category: 'cosmology',
    tags: [],
    keywords: [],
    injectionMode: 'always',
    priority: 10,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'lore_syndicate',
    branchId: 'br_1',
    title: 'Origins of the Syndicate',
    body: 'Founded by exiled archivists.',
    category: 'history',
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 5,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

const SIGNALS: RowSignalsSnapshot = {
  inScene: new Set(['char_kael', 'item_blade', 'loc_hollow']),
  recentlyClassified: {
    rows: new Map([
      ['char_brannoc_2', 'fresh'],
      ['char_vorne', 'fading'],
    ]),
    byCategory: new Map([['character', 'fresh']]),
  },
}

const TIER_HEADER = /^(Active|Staged|Retired)\s*\d+$/

type HarnessProps = {
  category?: WorldCategory
  filter?: EntityFilter
  search?: string
  entities?: Entity[]
  lore?: Lore[]
  leadId?: string | null
  /** Adds 25 rows of this status that sort ahead of Brannoc, so a reveal has to scroll. */
  fillers?: Entity['status']
  showRevealButton?: boolean
  /** The row the harness's reveal button passes to the handle. */
  revealId?: string
  /** Mirrors the route's review pill: switches to Characters and reveals in one handler. */
  showPillButton?: boolean
}

function Harness({
  category: initialCategory = 'character',
  filter: initialFilter = 'all',
  search: initialSearch = '',
  entities: baseEntities = ENTITIES,
  lore = LORE,
  leadId = 'char_kael',
  fillers,
  showRevealButton = false,
  revealId = 'char_brannoc_2',
  showPillButton = false,
}: HarnessProps) {
  const [category, setCategory] = useState<WorldCategory>(initialCategory)
  const [filter, setFilter] = useState<EntityFilter>(initialFilter)
  const [search, setSearch] = useState(initialSearch)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const ref = useRef<WorldListPaneHandle>(null)
  const entities = useMemo(
    () => (fillers == null ? baseEntities : [...baseEntities, ...fillerRows(fillers)]),
    [baseEntities, fillers],
  )
  const collisions = useMemo(() => deriveCollisions(entities), [entities])
  const selectCategory = (next: WorldCategory) => {
    setCategory(next)
    setSelectedId(null)
    setFilter('all')
    setSearch('')
  }
  return (
    <View
      style={{ width: 340, maxWidth: '100%', height: 600 }}
      className="rounded-md border border-border"
    >
      {showRevealButton ? (
        <Button variant="secondary" onPress={() => ref.current?.revealRow(revealId)}>
          <Text>Reveal row</Text>
        </Button>
      ) : null}
      {showPillButton ? (
        <Button
          variant="secondary"
          onPress={() => {
            selectCategory('character')
            ref.current?.revealRow(revealId)
          }}
        >
          <Text>Review pill</Text>
        </Button>
      ) : null}
      <WorldListPane
        ref={ref}
        category={category}
        onCategoryChange={selectCategory}
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        entities={entities}
        lore={lore}
        selectedId={selectedId}
        onSelect={setSelectedId}
        signals={SIGNALS}
        leadId={leadId}
        leadLabel="you"
        collisions={collisions}
        onJumpToRow={(id) => {
          setSelectedId(id)
          ref.current?.revealRow(id)
        }}
        resolveCollision={{ disabledReason: 'Lands in Slice 4.2c' }}
        addSlot={
          <ImporterMenu
            trigger="icon"
            label={worldAddLabel(category)}
            options={worldAddOptions(category)}
            open={addOpen}
            onOpenChange={setAddOpen}
          />
        }
      />
    </View>
  )
}

function scrollContainerOf(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node != null; node = node.parentElement) {
    if (getComputedStyle(node).overflowY === 'auto') return node
  }
  throw new Error('no scroll container above the row')
}

// A reveal waits out a 200ms accordion animation, then scrolls smoothly; slow CI needs margin.
const REVEAL_WAIT = { timeout: 3000 }

/** The list moved, and the row now sits inside the scroll container's visible rect. */
async function expectScrolledIntoView(row: HTMLElement) {
  const container = scrollContainerOf(row)
  await waitFor(() => {
    expect(container.scrollTop).toBeGreaterThan(0)
    const r = row.getBoundingClientRect()
    const c = container.getBoundingClientRect()
    expect(r.top).toBeGreaterThanOrEqual(c.top - 1)
    expect(r.bottom).toBeLessThanOrEqual(c.bottom + 1)
  }, REVEAL_WAIT)
}

/**
 * Elements in the toolbar block other than the search field, its contents and
 * its wrappers — the chip row when shown. Holds in both toolbar layouts.
 */
function toolbarExtras(searchPlaceholder: string): Element[] {
  const field = screen.getByPlaceholderText(searchPlaceholder).parentElement as Element
  const kindSelector = screen.getByLabelText('Category')
  let toolbar = field
  while (toolbar.parentElement != null && !toolbar.parentElement.contains(kindSelector)) {
    toolbar = toolbar.parentElement
  }
  return Array.from(toolbar.querySelectorAll('*')).filter(
    (el) => !el.contains(field) && !field.contains(el),
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/World/WorldListPane',
  component: Harness,
  parameters: { layout: 'padded' },
  // Session-scoped module state: reset before render so no story inherits the last one's tiers.
  beforeEach: () => {
    worldListStore.__reset()
  },
}

export default meta
type Story = StoryObj<typeof Harness>

/** Characters, All view: the lead pinned above the tiers, in-scene stripe, Staged / Retired collapsed. */
export const Characters: Story = {
  play: async () => {
    const rows = await screen.findAllByRole('button', { name: /Kael|Mira|Brannoc/ })
    expect(rows[0]).toHaveAccessibleName('Kael')
    expect(screen.getByText('You')).toBeInTheDocument()
    // An Active lead pins too: above the Active header, and out of its count.
    const activeHeader = screen.getByRole('button', { name: /^Active\s*\d+$/ })
    expect(rows[0].compareDocumentPosition(activeHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(activeHeader).toHaveAccessibleName(/^Active\s*2$/)
    expect(toolbarExtras('Search characters…')).toContain(
      screen.getByRole('button', { name: 'All' }),
    )
    // Staged and Retired start collapsed — their rows are not mounted.
    expect(screen.queryByRole('button', { name: 'The Ashen Sage' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Vorne' })).toBeNull()
    // The pane feeds each row its channels: Kael is in scene, the flagged Brannoc is fresh.
    const kael = screen.getByRole('button', { name: 'Kael' })
    const mira = screen.getByRole('button', { name: 'Mira' })
    const brannoc = screen.getByRole('button', { name: 'Brannoc' })
    expect(kael.querySelector('.left-0.bg-success')).not.toBeNull()
    expect(mira.querySelector('.left-0.bg-success')).toBeNull()
    expect(brannoc).toHaveClass('bg-recently-classified-bg')
    expect(kael).not.toHaveClass('bg-recently-classified-bg')
  },
}

/** A non-Active lead pins above the accordion, out of its (still collapsed) tier. */
export const LeadPinnedWhenStaged: Story = {
  args: { leadId: 'char_sage' },
  play: async () => {
    const sage = await screen.findByRole('button', { name: 'The Ashen Sage' })
    expect(within(sage).getByText('You')).toBeInTheDocument()
    const activeHeader = screen.getByRole('button', { name: /^Active\s*\d+$/ })
    expect(sage.compareDocumentPosition(activeHeader) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    const stagedHeader = screen.getByRole('button', { name: /^Staged\s*\d+$/ })
    expect(stagedHeader).toHaveAccessibleName(/^Staged\s*1$/)
    expect(stagedHeader).toHaveAttribute('aria-expanded', 'false')
    // Only the active namesake is mounted; the staged one stays inside the collapsed tier.
    expect(screen.getAllByRole('button', { name: 'Brannoc' })).toHaveLength(1)
  },
}

/** Header clicks write through to the session store: open Staged, close Active. */
export const ToggleTiers: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: /^Staged\s*\d+$/ }))
    expect(await screen.findByRole('button', { name: 'The Ashen Sage' })).toBeInTheDocument()
    expect(worldListStore.getCollapsedTiers().has('staged')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /^Active\s*\d+$/ }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mira' })).toBeNull())
    // The pinned lead sits outside every tier, so collapsing Active leaves it listed.
    expect(screen.getByRole('button', { name: 'Kael' })).toBeInTheDocument()
    expect(worldListStore.getCollapsedTiers().has('active')).toBe(true)
  },
}

export const Locations: Story = { args: { category: 'location' } }
export const Items: Story = { args: { category: 'item' } }
export const Factions: Story = { args: { category: 'faction' } }

/** Lore: no filter chips, priority-desc order, category tag. */
export const LoreCategory: Story = {
  args: { category: 'lore' },
  play: async () => {
    const rows = await screen.findAllByRole('button', { name: /Veil|Syndicate/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'The Veil',
      'Origins of the Syndicate',
    ])
    expect(screen.getByText('cosmology')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Staged' })).toBeNull()
    expect(toolbarExtras('Search lore…')).toHaveLength(0)
  },
}

/** Narrowed to Staged: flat list, alphabetical, no accordion headers. */
export const FilterStaged: Story = {
  args: { filter: 'staged' },
  play: async () => {
    const rows = await screen.findAllByRole('button', { name: /Brannoc|Ashen/ })
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Brannoc', 'The Ashen Sage'])
    expect(screen.getByRole('button', { name: 'Staged' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryAllByRole('button', { name: TIER_HEADER })).toHaveLength(0)
  },
}

/** Flagged row in the expanded Active tier: strip with a disabled Resolve, no header badge. */
export const FlaggedRow: Story = {
  play: async () => {
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    expect(screen.getByTitle('Lands in Slice 4.2c')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /needs? review/ })).toBeNull()
  },
}

/** Collapsed Active with a flagged row inside: badge shows; expands and scrolls to it. */
export const CollapsedWithBadge: Story = {
  args: { fillers: 'active' },
  beforeEach: () => {
    worldListStore.setCollapsed('active', true)
  },
  play: async () => {
    const badge = await screen.findByRole('button', { name: '1 in Active needs review' })
    expect(screen.queryByRole('link', { name: '⚠ Collides with Brannoc' })).toBeNull()
    await userEvent.click(badge)
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
    await waitFor(
      () => expect(screen.queryByRole('button', { name: '1 in Active needs review' })).toBeNull(),
      REVEAL_WAIT,
    )
  },
}

/** The imperative handle the top-bar pill calls: expands the tier and scrolls to the row. */
export const RevealFromOutside: Story = {
  args: { fillers: 'active', showRevealButton: true },
  beforeEach: () => {
    worldListStore.setCollapsed('active', true)
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal row' }))
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
  },
}

/**
 * A narrowing chip and search exclude the flagged Active row; the reveal must
 * widen the view back to All before it can mount and scroll.
 */
export const RevealClearsNarrowedFilter: Story = {
  args: { filter: 'staged', search: 'zzz', fillers: 'active', showRevealButton: true },
  play: async () => {
    expect(screen.queryByRole('link', { name: '⚠ Collides with Brannoc' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal row' }))
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByPlaceholderText('Search characters…')).toHaveValue('')
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
  },
}

/** Revealing the pinned lead widens the view but leaves its tier collapsed. */
export const RevealPinnedLeadKeepsTier: Story = {
  args: { leadId: 'char_sage', filter: 'active', showRevealButton: true, revealId: 'char_sage' },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'The Ashen Sage' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal row' }))
    expect(await screen.findByRole('button', { name: 'The Ashen Sage' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Staged\s*\d+$/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(worldListStore.getCollapsedTiers().has('staged')).toBe(true)
  },
}

/**
 * The strip link selects the namesake, expands Staged and scrolls to it. Staged
 * fillers keep it far from the link, since focusing the clicked link scrolls too.
 */
export const JumpToNamesake: Story = {
  args: { fillers: 'staged' },
  play: async () => {
    await userEvent.click(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' }))
    const target = await waitFor(() => {
      const selected = screen
        .getAllByRole('button', { name: 'Brannoc' })
        .find((row) => row.getAttribute('aria-selected') === 'true')
      expect(selected).toBeDefined()
      return selected as HTMLElement
    }, REVEAL_WAIT)
    expect(within(target).getByText('staged')).toBeInTheDocument()
    await expectScrolledIntoView(target)
  },
}

/** Search reaches into state.visual.hair. */
export const SearchStateField: Story = {
  args: { search: 'dark' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Kael' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mira' })).toBeNull()
  },
}

export const NoResults: Story = {
  args: { search: 'zzz-no-such-term' },
  play: async () => {
    expect(await screen.findByText('No results.')).toBeInTheDocument()
    // Toolbar stays: the search input and chips are still on screen.
    expect(screen.getByPlaceholderText('Search characters…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
    expect(screen.queryByText('No characters on this branch yet.')).toBeNull()
  },
}

export const Empty: Story = {
  args: { entities: [], lore: [] },
  play: async () => {
    expect(await screen.findByText('No characters on this branch yet.')).toBeInTheDocument()
    expect(screen.queryByText('No results.')).toBeNull()
  },
}

/** The `[+]` menu: every option present, disabled, with its reason. */
export const AddMenuDisabledEntries: Story = {
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'New character' }))
    expect(await screen.findByTitle('Lands in Slice 4.2a')).toBeInTheDocument()
    expect(screen.getByTitle('Lands in Slice 4.6')).toBeInTheDocument()
    expect(screen.getByTitle('Vault lands in M8')).toBeInTheDocument()
  },
}

/** A visual render at phone width; on web the pane has no phone-specific behavior to assert. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
}

/** A search that already shows the flagged row survives the reveal; only its tier opens. */
export const RevealKeepsSearchThatShowsRow: Story = {
  args: { search: 'Brannoc', fillers: 'active' },
  beforeEach: () => {
    worldListStore.setCollapsed('active', true)
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: '1 in Active needs review' }))
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
    expect(screen.getByPlaceholderText('Search characters…')).toHaveValue('Brannoc')
  },
}

/** A category switch starts the new list at the top, though the list instance is reused. */
export const CategorySwitchScrollsToTop: Story = {
  args: { entities: LONG_LISTS },
  play: async () => {
    const container = scrollContainerOf(await screen.findByRole('button', { name: 'Kael' }))
    container.scrollTop = 400
    await waitFor(() => expect(container.scrollTop).toBe(400))
    await userEvent.click(screen.getByLabelText('Category'))
    await userEvent.click(await screen.findByRole('option', { name: 'Locations' }))
    const hollow = await screen.findByRole('button', { name: "Veil's Hollow" })
    await waitFor(() => expect(scrollContainerOf(hollow).scrollTop).toBe(0), REVEAL_WAIT)
  },
}

/** The pill switches category and reveals in one update: the list scrolls on from where it was. */
export const PillSwitchesCategoryAndReveals: Story = {
  args: { category: 'location', entities: LONG_LISTS, showPillButton: true },
  play: async () => {
    const container = scrollContainerOf(
      await screen.findByRole('button', { name: "Veil's Hollow" }),
    )
    container.scrollTop = 400
    await waitFor(() => expect(container.scrollTop).toBe(400))
    const offsets: number[] = []
    const record = () => offsets.push(container.scrollTop)
    container.addEventListener('scroll', record)
    await userEvent.click(screen.getByRole('button', { name: 'Review pill' }))
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
    container.removeEventListener('scroll', record)
    // A reset to the top before the reveal's smooth scroll would dip below the start.
    expect(offsets.length).toBeGreaterThan(0)
    expect(Math.min(...offsets)).toBeGreaterThanOrEqual(399)
  },
}

/**
 * The pill from another category's narrowing chip: the pane's pre-switch closure still
 * holds that chip, yet the flagged row's collapsed tier must open and the list scroll to it.
 */
export const PillFromNarrowChipOpensCollapsedTier: Story = {
  args: { category: 'location', filter: 'active', fillers: 'active', showPillButton: true },
  beforeEach: () => {
    worldListStore.setCollapsed('active', true)
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Veil's Hollow" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Review pill' }))
    expect(await screen.findByRole('link', { name: '⚠ Collides with Brannoc' })).toBeInTheDocument()
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(worldListStore.getCollapsedTiers().has('active')).toBe(false)
  },
}

/**
 * Only the accordion's own animation holds a reveal back: a row animation that
 * outlasts REVEAL_WAIT runs throughout, and the staged row still scrolls into view.
 */
export const UnrelatedRowAnimationDoesNotDelayReveal: Story = {
  args: { fillers: 'staged', showRevealButton: true, revealId: 'char_brannoc' },
  play: async () => {
    const kael = await screen.findByRole('button', { name: 'Kael' })
    const probe = document.createElement('style')
    probe.textContent =
      '@keyframes story-probe { to { opacity: 0.9 } } [aria-label="Kael"] { animation: story-probe 10s linear; }'
    document.head.append(probe)
    try {
      const probing = kael
        .getAnimations()
        .some((a) => a instanceof CSSAnimation && a.animationName === 'story-probe')
      expect(probing).toBe(true)
      await userEvent.click(screen.getByRole('button', { name: 'Reveal row' }))
      const target = await waitFor(() => {
        const staged = screen
          .getAllByRole('button', { name: 'Brannoc' })
          .find((row) => within(row).queryByText('staged') != null)
        expect(staged).toBeDefined()
        return staged as HTMLElement
      }, REVEAL_WAIT)
      await expectScrolledIntoView(target)
    } finally {
      probe.remove()
    }
  },
}

/** Under a narrowing chip the list is flat: the row scrolls into view, its tier stays collapsed. */
export const RevealInFlatViewKeepsCollapse: Story = {
  args: { filter: 'active', fillers: 'active', showRevealButton: true },
  beforeEach: () => {
    worldListStore.setCollapsed('active', true)
  },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal row' }))
    await expectScrolledIntoView(screen.getByRole('button', { name: 'Brannoc' }))
    expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true')
    expect(worldListStore.getCollapsedTiers().has('active')).toBe(true)
  },
}

// Five steady frames, not two equal polls, which a smooth scroll can pass mid-flight.
async function waitForScrollToSettle(container: HTMLElement) {
  let last = container.scrollTop
  let steadyFrames = 0
  for (let frame = 0; frame < 300 && steadyFrames < 5; frame++) {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    steadyFrames = container.scrollTop === last ? steadyFrames + 1 : 0
    last = container.scrollTop
  }
  expect(steadyFrames).toBeGreaterThanOrEqual(5)
}

/** Revealing the same row again scrolls back to it: every request is fresh. */
export const RepeatRevealScrollsAgain: Story = {
  args: { fillers: 'active', showRevealButton: true },
  play: async () => {
    const reveal = await screen.findByRole('button', { name: 'Reveal row' })
    await userEvent.click(reveal)
    const row = screen.getByRole('button', { name: 'Brannoc' })
    await expectScrolledIntoView(row)
    const container = scrollContainerOf(row)
    // Let the first smooth scroll finish, or it would carry the list back on its own.
    await waitForScrollToSettle(container)
    container.scrollTop = 0
    await waitFor(() => expect(container.scrollTop).toBe(0))
    expect(row.getBoundingClientRect().top).toBeGreaterThan(
      container.getBoundingClientRect().bottom,
    )
    await userEvent.click(reveal)
    await expectScrolledIntoView(row)
  },
}
