import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { Plus } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import type { Happening, Thread } from '@/lib/db'
import type { EntryIndex, EntryRef } from '@/lib/entry-refs'
import type { HappeningFilter, PlotKind, PlotListSignals, ThreadFilter } from '@/lib/list-modules'
import { listCollapseStore } from '@/lib/stores'

import { PlotListPane, type PlotListPaneHandle } from './plot-list-pane'

function thread(
  id: string,
  title: string,
  status: Thread['status'],
  category: string,
  icon: string,
): Thread {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category,
    icon,
    status,
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function happening(id: string, title: string, extra: Partial<Happening>): Happening {
  return {
    id,
    branchId: 'br_1',
    title,
    description: null,
    category: 'conflict',
    icon: 'swords',
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

const THREADS: Thread[] = [
  thread('t_amulet', 'What the amulet wants', 'active', 'mystery', 'sparkles'),
  thread('t_syndicate', 'Expose the Syndicate broker', 'pending', 'goal', 'eye'),
  thread('t_trust', "Earn Mira's trust", 'resolved', 'relationship', 'handshake'),
  thread('t_keep', 'Escape the River Keep', 'failed', 'goal', 'door'),
]

const HAPPENINGS: Happening[] = [
  happening('h_ambush', 'The alley ambush', { occurredAtEntryId: 'e_10' }),
  happening('h_fire', 'The market fire', {
    occurredAtEntryId: 'e_22',
    commonKnowledge: 1,
    category: 'disaster',
  }),
  happening('h_betrayal', 'The old betrayal', { temporal: 'years past', category: 'history' }),
  happening('h_pact', "Vorne's pact", { occurredAtEntryId: 'e_48' }),
]

function entries(closedThrough: number): EntryIndex {
  const rows: EntryRef[] = Array.from({ length: 60 }, (_, i) => ({
    id: `e_${i + 1}`,
    position: i + 1,
    kind: 'ai_reply',
    chapterId: i + 1 <= closedThrough ? 'chap_1' : null,
    excerpt: `Entry ${i + 1}`,
  }))
  return new Map(rows.map((r) => [r.id, r]))
}

const WITH_CHAPTERS: PlotListSignals = { entries: entries(30), hasClosedChapters: true }
const NO_CHAPTERS: PlotListSignals = { entries: entries(0), hasClosedChapters: false }

type HarnessProps = {
  initialKind?: PlotKind
  signals?: PlotListSignals
  threads?: Thread[]
  happenings?: Happening[]
  showRevealButton?: boolean
  revealKind?: PlotKind
  revealId?: string
  /** Flips `listSignals` between WITH_CHAPTERS and NO_CHAPTERS, mid-session. */
  showChapterToggle?: boolean
  initialSearch?: string
  initialThreadFilter?: ThreadFilter
  initialHappeningFilter?: HappeningFilter
}

function Harness({
  initialKind = 'thread',
  signals = WITH_CHAPTERS,
  threads = THREADS,
  happenings = HAPPENINGS,
  showRevealButton = false,
  revealKind = 'thread',
  revealId = 't_syndicate',
  showChapterToggle = false,
  initialSearch = '',
  initialThreadFilter = 'all',
  initialHappeningFilter = 'all',
}: HarnessProps) {
  const [kind, setKind] = useState<PlotKind>(initialKind)
  const [threadFilter, setThreadFilter] = useState<ThreadFilter>(initialThreadFilter)
  const [happeningFilter, setHappeningFilter] = useState<HappeningFilter>(initialHappeningFilter)
  const [search, setSearch] = useState(initialSearch)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [listSignals, setListSignals] = useState<PlotListSignals>(signals)
  const ref = useRef<PlotListPaneHandle>(null)
  return (
    <View style={{ width: 360, maxWidth: '100%', height: 600 }} className="border border-border">
      {showRevealButton ? (
        <Button variant="secondary" onPress={() => ref.current?.revealRow(revealKind, revealId)}>
          <Text>Reveal row</Text>
        </Button>
      ) : null}
      {showChapterToggle ? (
        <Button
          variant="secondary"
          onPress={() => setListSignals((s) => (s === WITH_CHAPTERS ? NO_CHAPTERS : WITH_CHAPTERS))}
        >
          <Text>Toggle chapters</Text>
        </Button>
      ) : null}
      <PlotListPane
        ref={ref}
        kind={kind}
        onKindChange={(next) => {
          setKind(next)
          setThreadFilter('all')
          setHappeningFilter('all')
          setSearch('')
          setSelectedId(null)
        }}
        threadFilter={threadFilter}
        onThreadFilterChange={setThreadFilter}
        happeningFilter={happeningFilter}
        onHappeningFilterChange={setHappeningFilter}
        search={search}
        onSearchChange={setSearch}
        threads={threads}
        happenings={happenings}
        listSignals={listSignals}
        selectedId={selectedId}
        onSelect={setSelectedId}
        recentlyClassified={new Map([['t_amulet', 'fresh']])}
        addSlot={<IconAction icon={Plus} label="New thread" onPress={() => {}} />}
      />
    </View>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Compounds/Plot/PlotListPane',
  component: Harness,
  parameters: { layout: 'padded' },
  // Session-scoped module state: reset before render so no story inherits the last one's tiers.
  beforeEach: () => {
    listCollapseStore.__reset()
  },
}
export default meta
type Story = StoryObj<typeof Harness>

const header = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) })

// CI runs plays several times slower than local; every post-interaction wait uses this.
const INTERACTION_WAIT = { timeout: 3000 }

// Toolbar first renders from useTier()'s window guess (one row), then remounts search and
// chips in its narrow branch once onLayout reports the 360 px harness; only that branch stacks them.
async function toolbarSettled() {
  await waitFor(() => {
    const search = screen.getByRole('textbox').getBoundingClientRect()
    const chip = screen.getByRole('button', { name: 'All' }).getBoundingClientRect()
    expect(chip.top).toBeGreaterThanOrEqual(search.bottom)
  }, INTERACTION_WAIT)
}

/** Threads: Active starts open, the rest collapsed; a header click and a chip both work. */
export const Threads: Story = {
  play: async () => {
    expect(await screen.findByRole('button', { name: 'What the amulet wants' })).toBeVisible()
    expect(header('Active')).toHaveAttribute('aria-expanded', 'true')
    expect(header('Pending')).toHaveAttribute('aria-expanded', 'false')
    expect(header('Resolved')).toHaveAttribute('aria-expanded', 'false')
    expect(header('Failed')).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('button', { name: 'Expose the Syndicate broker' }),
    ).not.toBeInTheDocument()
    await userEvent.click(header('Pending'))
    expect(
      await screen.findByRole('button', { name: 'Expose the Syndicate broker' }, INTERACTION_WAIT),
    ).toBeInTheDocument()
    await toolbarSettled()
    await userEvent.click(screen.getByRole('button', { name: 'Failed', pressed: false }))
    expect(
      await screen.findByRole('button', { name: 'Escape the River Keep' }, INTERACTION_WAIT),
    ).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'What the amulet wants' }),
      ).not.toBeInTheDocument()
    }, INTERACTION_WAIT)
  },
}

/** Happenings, with closed chapters: Current open, Earlier and Out of narrative collapsed. */
export const HappeningsWithChapters: Story = {
  args: { initialKind: 'happening' },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Vorne's pact" })).toBeVisible()
    expect(header('Current chapter')).toHaveAttribute('aria-expanded', 'true')
    expect(header('Earlier chapters')).toHaveAttribute('aria-expanded', 'false')
    expect(header('Out of narrative')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'This chapter', pressed: false })).toBeVisible()
    await toolbarSettled()
    await userEvent.click(screen.getByRole('button', { name: 'Out-of-narrative', pressed: false }))
    expect(
      await screen.findByRole('button', { name: 'The old betrayal' }, INTERACTION_WAIT),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: "Vorne's pact" })).not.toBeInTheDocument()
  },
}

/** No chapter has closed: `This chapter` is hidden and everything anchored sits in Current. */
export const HappeningsChapterless: Story = {
  args: { initialKind: 'happening', signals: NO_CHAPTERS },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Vorne's pact" })).toBeVisible()
    // Anchored at entry 10, inside the closed chapter under WITH_CHAPTERS — only landing here
    // because no chapter is closed proves the bucket logic, not just its label.
    expect(screen.getByRole('button', { name: 'The alley ambush' })).toBeVisible()
    expect(header('Current chapter')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('button', { name: /^Earlier chapters/ })).not.toBeInTheDocument()
    expect(header('Out of narrative')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'This chapter' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Common knowledge', pressed: false })).toBeVisible()
  },
}

/** The segment swaps the whole list, at the default (desktop) tier. */
export const SegmentSwitch: Story = {
  play: async () => {
    expect(await screen.findByRole('button', { name: 'What the amulet wants' })).toBeVisible()
    await userEvent.click(screen.getByText('Happenings'))
    // Vorne's pact sits in the Current bucket, open by default; the alley ambush sits in the
    // collapsed Earlier bucket and would never mount.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: "Vorne's pact" })).toBeVisible()
    }, INTERACTION_WAIT)
  },
}

export const EmptyThreads: Story = {
  args: { threads: [] },
  play: async () => {
    expect(await screen.findByText('No threads on this branch yet.')).toBeVisible()
  },
}

export const NoResults: Story = {
  args: { initialSearch: 'zzz' },
  play: async () => {
    expect(await screen.findByText('No results.')).toBeVisible()
  },
}

/** Typing into the search narrows the list to rows matching the query. */
export const SearchNarrows: Story = {
  play: async () => {
    expect(await screen.findByRole('button', { name: 'What the amulet wants' })).toBeVisible()
    await userEvent.click(header('Pending'))
    expect(
      await screen.findByRole('button', { name: 'Expose the Syndicate broker' }, INTERACTION_WAIT),
    ).toBeVisible()
    await toolbarSettled()
    await userEvent.type(screen.getByPlaceholderText('Search threads…'), 'syndicate')
    expect(
      await screen.findByRole('button', { name: 'Expose the Syndicate broker' }, INTERACTION_WAIT),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: 'What the amulet wants' })).not.toBeInTheDocument()
  },
}

/** The imperative handle: a narrowing chip and search widen back to All before the row scrolls in. */
export const Reveal: Story = {
  args: { showRevealButton: true, initialThreadFilter: 'failed', initialSearch: 'zzz' },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Failed', pressed: true })).toBeVisible()
    expect(screen.getByPlaceholderText('Search threads…')).toHaveValue('zzz')
    expect(screen.getByText('No results.')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Expose the Syndicate broker' }),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal row' }))
    expect(
      await screen.findByRole('button', { name: 'Expose the Syndicate broker' }, INTERACTION_WAIT),
    ).toBeVisible()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeVisible()
      expect(screen.getByPlaceholderText('Search threads…')).toHaveValue('')
      expect(header('Pending')).toHaveAttribute('aria-expanded', 'true')
    }, INTERACTION_WAIT)
  },
}

/** A reveal request for the other kind is ignored: no widen, no collapse write. */
export const RevealCrossKindIsNoop: Story = {
  args: { initialKind: 'happening', initialSearch: 'zzz', showRevealButton: true },
  play: async () => {
    expect(await screen.findByPlaceholderText('Search happenings…')).toHaveValue('zzz')
    await userEvent.click(screen.getByRole('button', { name: 'Reveal row' }))
    expect(screen.getByPlaceholderText('Search happenings…')).toHaveValue('zzz')
    const untouched = new Set<string>()
    expect(listCollapseStore.getCollapsed('thread', untouched)).toBe(untouched)
  },
}

/** A happening-kind reveal widens its own chip and search. */
export const RevealHappeningWidensOwnFilter: Story = {
  args: {
    initialKind: 'happening',
    initialHappeningFilter: 'this-chapter',
    initialSearch: 'zzz',
    showRevealButton: true,
    revealKind: 'happening',
    revealId: 'h_betrayal',
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'This chapter', pressed: true })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'The old betrayal' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal row' }))
    expect(
      await screen.findByRole('button', { name: 'The old betrayal' }, INTERACTION_WAIT),
    ).toBeVisible()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeVisible()
      expect(screen.getByPlaceholderText('Search happenings…')).toHaveValue('')
      expect(header('Out of narrative')).toHaveAttribute('aria-expanded', 'true')
    }, INTERACTION_WAIT)
  },
}

/** The handle expands a collapsed happening bucket before scrolling to the row. */
export const RevealHappeningInCollapsedBucket: Story = {
  args: {
    initialKind: 'happening',
    showRevealButton: true,
    revealKind: 'happening',
    revealId: 'h_fire',
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Vorne's pact" })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'The market fire' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reveal row' }))
    expect(
      await screen.findByRole('button', { name: 'The market fire' }, INTERACTION_WAIT),
    ).toBeVisible()
    await waitFor(() => {
      expect(header('Earlier chapters')).toHaveAttribute('aria-expanded', 'true')
    }, INTERACTION_WAIT)
  },
}

/** `This chapter` leaves the vocabulary mid-session when the branch's chapters change under it. */
export const FilterShrink: Story = {
  args: {
    initialKind: 'happening',
    initialHappeningFilter: 'this-chapter',
    showChapterToggle: true,
  },
  play: async () => {
    expect(await screen.findByRole('button', { name: 'This chapter', pressed: true })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Toggle chapters' }))
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'This chapter' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'All', pressed: true })).toBeVisible()
    }, INTERACTION_WAIT)
  },
}

/** A visual render at phone width; on web the pane has no phone-specific behavior to assert. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: { initialKind: 'happening' },
  play: async () => {
    expect(await screen.findByRole('button', { name: "Vorne's pact" })).toBeVisible()
    await userEvent.click(screen.getByText('Threads'))
    expect(
      await screen.findByRole('button', { name: 'What the amulet wants' }, INTERACTION_WAIT),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: "Vorne's pact" })).not.toBeInTheDocument()
  },
}
