import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { plotCollapseDefaults } from '@/components/plot/plot-list-pane'
import { WORLD_COLLAPSED_DEFAULTS } from '@/components/world/world-list-pane'
import { railViewFor, type RailCategory, type RailView } from '@/lib/reader-rail'
import { listCollapseStore } from '@/lib/stores'

import { BrowseRail } from './browse-rail'
import { railDataFixture } from './rail-story-fixtures'
import type { RailData } from './use-rail-data'

const DATA = railDataFixture()
const EMPTY = railDataFixture({ entities: [], lore: [], threads: [], happenings: [] })
const INDEX_PENDING = railDataFixture({
  entryIndex: { ready: false, failed: false, retry: () => {} },
})
const NO_PLACES = railDataFixture({
  entities: DATA.entities.filter((e) => e.kind !== 'location'),
})
const NO_CLOSED_CHAPTER = railDataFixture({
  plotListSignals: { entries: DATA.plotListSignals.entries, hasClosedChapters: false },
})

type HarnessProps = {
  category?: RailCategory
  /** Starts on this exact view instead of `railViewFor(category)`. */
  initialView?: RailView
  data?: RailData
  /** Starts with the entry index unread and lands it (`data`) after this many milliseconds. */
  landIndexAfterMs?: number
  onRowPress: (category: RailCategory, id: string) => void
  onCollapse: () => void
}

function Harness({
  category = 'character',
  initialView,
  data = DATA,
  landIndexAfterMs,
  onRowPress,
  onCollapse,
}: HarnessProps) {
  const [view, setView] = useState<RailView>(() => initialView ?? railViewFor(category))
  const [landed, setLanded] = useState(landIndexAfterMs == null)
  useEffect(() => {
    if (landIndexAfterMs == null) return
    const id = setTimeout(() => setLanded(true), landIndexAfterMs)
    return () => clearTimeout(id)
  }, [landIndexAfterMs])
  return (
    <View style={{ width: 300, height: 640 }} className="border-l border-border">
      <BrowseRail
        data={landed ? data : INDEX_PENDING}
        view={view}
        onViewChange={setView}
        onCategoryChange={(next) => setView(railViewFor(next))}
        onRowPress={onRowPress}
        onCollapse={onCollapse}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/Reader/BrowseRail',
  component: Harness,
  parameters: { layout: 'padded' },
  args: { onRowPress: fn(), onCollapse: fn() },
  // Session-scoped module state: reset before render so no story inherits the last one's groups.
  beforeEach: () => {
    listCollapseStore.__reset()
  },
}

export default meta
type Story = StoryObj<typeof Harness>

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 3000 }

/**
 * Characters: the lead pinned with its badge, World's tier defaults and collapse key, the
 * collapse chevron, the inert Vault footer.
 */
export const Characters: Story = {
  play: async ({ args }) => {
    const rows = await screen.findAllByRole('button', { name: /^(Kael|Mira)$/ })
    expect(rows[0]).toHaveAccessibleName('Kael')
    expect(within(rows[0]).getByText('You')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search characters…')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Vorne' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Staged\s*1$/ }))
    expect(await screen.findByRole('button', { name: 'Vorne' }, WAIT)).toBeVisible()
    expect(
      listCollapseStore.getCollapsed('character', WORLD_COLLAPSED_DEFAULTS).has('staged'),
    ).toBe(false)
    const vault = screen.getByRole('button', { name: '+ Import from Vault' })
    expect(vault).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTitle('Vault lands in M8')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Collapse rail' }))
    expect(args.onCollapse).toHaveBeenCalledTimes(1)
    expect(screen.getByTitle('Collapse rail')).toBeInTheDocument()
    // The kind's filter chips and search are wired to the view.
    await userEvent.click(screen.getByRole('button', { name: 'In scene' }))
    expect(
      await screen.findByRole('button', { name: 'In scene', pressed: true }, WAIT),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Vorne' })).toBeNull()
    await userEvent.type(screen.getByPlaceholderText('Search characters…'), 'Mir')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Kael' })).toBeNull(), WAIT)
    expect(screen.getByRole('button', { name: 'Mira' })).toBeVisible()
    expect(args.onRowPress).not.toHaveBeenCalled()
  },
}

export const Places: Story = {
  args: { category: 'location' },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Veil's Hollow" })).toBeVisible()
    expect(screen.getByPlaceholderText('Search places…')).toBeVisible()
  },
}

export const Items: Story = {
  args: { category: 'item' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Courier blade' })).toBeVisible()
    expect(screen.getByPlaceholderText('Search items…')).toBeVisible()
  },
}

export const Factions: Story = {
  args: { category: 'faction' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'The Watch' })).toBeVisible()
    expect(screen.getByPlaceholderText('Search factions…')).toBeVisible()
  },
}

/** Compact density: the lore row drops its body excerpt; lore has no filter chips. */
export const Lore: Story = {
  args: { category: 'lore' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'The Veil' })).toBeVisible()
    expect(screen.queryByText(/membrane/)).toBeNull()
    expect(screen.getByPlaceholderText('Search lore…')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'All' })).toBeNull()
  },
}

/** Compact density: the thread row drops its category tag; Plot's tier defaults apply. */
export const Threads: Story = {
  args: { category: 'thread' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'What the amulet wants' })).toBeVisible()
    expect(screen.queryByText('mystery')).toBeNull()
    expect(screen.getByPlaceholderText('Search threads…')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Expose the Syndicate broker' })).toBeNull()
    // Opening a tier writes the collapse store under the category's own key, as Plot's panel does.
    await userEvent.click(screen.getByRole('button', { name: /^Pending\s*1$/ }))
    expect(
      await screen.findByRole('button', { name: 'Expose the Syndicate broker' }, WAIT),
    ).toBeVisible()
    expect(
      listCollapseStore.getCollapsed('thread', plotCollapseDefaults('thread')).has('pending'),
    ).toBe(false)
    // A filter chip narrows the rows to its tier.
    await userEvent.click(screen.getByRole('button', { name: 'Resolved' }))
    expect(
      await screen.findByRole('button', { name: 'Resolved', pressed: true }, WAIT),
    ).toBeVisible()
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'What the amulet wants' })).toBeNull(),
      WAIT,
    )
  },
}

/** A closed chapter offers `This chapter`; the Current bucket starts open. */
export const Happenings: Story = {
  args: { category: 'happening' },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Vorne's pact" })).toBeVisible()
    expect(screen.getByRole('button', { name: 'This chapter', pressed: false })).toBeVisible()
    expect(screen.getByPlaceholderText('Search happenings…')).toBeVisible()
    // The Earlier bucket starts collapsed.
    expect(screen.queryByRole('button', { name: 'The alley ambush' })).toBeNull()
    // A filter chip narrows the rows: nothing here is common knowledge.
    await userEvent.click(screen.getByRole('button', { name: 'Common knowledge' }))
    await waitFor(
      () => expect(screen.queryByRole('button', { name: "Vorne's pact" })).toBeNull(),
      WAIT,
    )
  },
}

/** `This chapter` left the vocabulary, so a view still holding it falls back to All. */
export const HappeningFilterReset: Story = {
  args: {
    initialView: { category: 'happening', filter: 'this-chapter', search: '' },
    data: NO_CLOSED_CHAPTER,
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'All', pressed: true }, WAIT)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'This chapter' })).toBeNull()
  },
}

/** An unread entry index would mark every anchored happening dangling, so the list waits. */
export const HappeningsLoading: Story = {
  args: {
    category: 'happening',
    data: railDataFixture({ entryIndex: { ready: false, failed: false, retry: () => {} } }),
  },
  play: async () => {
    expect(await screen.findByText('Loading happenings…', {}, WAIT)).toBeVisible()
    expect(screen.queryByRole('button', { name: "Vorne's pact" })).toBeNull()
    expect(screen.queryByText('Entry no longer exists')).toBeNull()
    // The category Select and the collapse chevron stay usable while the list waits.
    expect(screen.getByLabelText('Browse category')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Collapse rail' })).toBeVisible()
  },
}

export const HappeningsFailed: Story = {
  args: {
    category: 'happening',
    data: railDataFixture({ entryIndex: { ready: false, failed: true, retry: fn() } }),
  },
  play: async ({ args }) => {
    const data = args.data as RailData
    expect(await screen.findByText("Couldn't read this branch's entries.", {}, WAIT)).toBeVisible()
    expect(
      screen.getByText('The rail reads them again when the next run finishes, or when you retry.'),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: "Vorne's pact" })).toBeNull()
    expect(screen.queryByText('Loading happenings…')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(data.entryIndex.retry).toHaveBeenCalledTimes(1)
  },
}

/**
 * Switching to Happenings while the index is unread, then the index landing, must not remount the
 * header: the category Select keeps focus through both transitions.
 */
export const HappeningsIndexLands: Story = {
  args: { landIndexAfterMs: 600 },
  play: async () => {
    const trigger = await screen.findByLabelText('Browse category')
    await userEvent.click(trigger)
    await userEvent.click(await screen.findByRole('option', { name: 'Happenings' }))
    expect(await screen.findByText('Loading happenings…', {}, WAIT)).toBeVisible()
    await waitFor(() => expect(trigger).toHaveFocus(), WAIT)
    expect(await screen.findByRole('button', { name: "Vorne's pact" }, WAIT)).toBeVisible()
    expect(screen.queryByText('Loading happenings…')).toBeNull()
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveFocus()
  },
}

/** The rail's own empty copy: no `+ New` clause, which the rail has no affordance for. */
export const EmptyCategory: Story = {
  args: { category: 'location', data: NO_PLACES },
  play: async () => {
    expect(await screen.findByText('No places on this branch yet.')).toBeVisible()
    expect(
      screen.getByText('The classifier writes most rows automatically as the story progresses.'),
    ).toBeVisible()
    expect(screen.queryByText(/\+ New/)).toBeNull()
    expect(screen.getByPlaceholderText('Search places…')).toBeVisible()
  },
}

export const EmptyLore: Story = {
  args: { category: 'lore', data: EMPTY },
  play: async () => {
    expect(await screen.findByText('Add lore from the World panel.')).toBeVisible()
  },
}

/**
 * The Select groups the seven categories World / Plot; search scope copy rotates with the
 * category; a row press reports its category and id.
 */
export const CategorySwitch: Story = {
  play: async ({ args }) => {
    expect(await screen.findByPlaceholderText('Search characters…')).toBeVisible()
    await userEvent.click(screen.getByLabelText('Browse category'))
    // The popover fades in, so its group labels are not yet visible when they first mount.
    await waitFor(() => expect(screen.getByText('World')).toBeVisible(), WAIT)
    expect(screen.getByText('Plot')).toBeVisible()
    await userEvent.click(await screen.findByRole('option', { name: 'Places' }))
    expect(await screen.findByPlaceholderText('Search places…', {}, WAIT)).toBeVisible()
    await userEvent.click(screen.getByLabelText('Browse category'))
    await userEvent.click(await screen.findByRole('option', { name: 'Threads' }))
    expect(await screen.findByPlaceholderText('Search threads…', {}, WAIT)).toBeVisible()
    await userEvent.click(await screen.findByRole('button', { name: 'What the amulet wants' }))
    expect(args.onRowPress).toHaveBeenCalledWith('thread', 't_amulet')
  },
}
