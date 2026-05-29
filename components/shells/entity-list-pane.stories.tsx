import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { ChevronDown } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Toolbar } from '@/components/compounds/toolbar'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { EntityListPane } from './entity-list-pane'

const noop = () => {
  console.log('[story] action')
}

// Placeholder row used in place of the consumer's virtualized list
// rows. Kept deliberately lightweight (just a label + muted subtitle)
// so stories don't pull ListRow into the dependency graph.
function FakeListRow({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <View className="flex-row items-center gap-3 border-b border-border px-3 py-2">
      <View className="h-8 w-8 rounded-sm bg-bg-sunken" />
      <View className="min-w-0 flex-1">
        <Text size="sm" className="text-fg-primary">
          {label}
        </Text>
        {subtitle != null ? (
          <Text size="xs" variant="muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

// Placeholder kindSelector — mimics the "Characters ▾" trigger
// without pulling Select into the simplest story shape. Tap is a
// no-op; story is just demonstrating chrome.
function KindTriggerPlaceholder({ label }: { label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      className="flex-row items-center gap-1 self-start rounded-sm px-2 py-1 hover:bg-tint-hover"
      onPress={noop}
    >
      <Text size="base" className="font-medium text-fg-primary">
        {label}
      </Text>
      <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}

const meta: Meta<typeof EntityListPane> = {
  title: 'Shells/EntityListPane',
  component: EntityListPane,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof EntityListPane>

const CHARACTER_SCOPE = ['name', 'description', 'tags'] as const
const THREAD_SCOPE = ['title', 'description', 'tags'] as const
const LORE_SCOPE = ['title', 'body', 'category', 'tags'] as const

const CHARACTER_FILTERS = ['All', 'In scene', 'Active', 'Staged', 'Retired'] as const
const THREAD_FILTERS = ['All', 'Active', 'Pending', 'Resolved', 'Failed'] as const
const LORE_FILTERS = ['All', 'Worldbuilding', 'Politics', 'Religion', 'History'] as const

const FAKE_CHARACTERS = [
  { name: 'Aria', subtitle: 'Lead · in scene' },
  { name: 'Kael', subtitle: 'Active' },
  { name: 'Mira', subtitle: 'Active' },
  { name: 'Thane', subtitle: 'Staged' },
  { name: 'Selene', subtitle: 'Active' },
  { name: 'Bran', subtitle: 'Retired' },
  { name: 'Lyra', subtitle: 'Staged' },
]

const FAKE_THREADS = [
  { title: 'Find the missing heir', state: 'Active' },
  { title: 'Resolve the trade dispute', state: 'Pending' },
  { title: 'Escape the silver tower', state: 'Active' },
  { title: 'Recover the relic', state: 'Resolved' },
]

const FAKE_LORE = [
  { title: 'The Sundering', cat: 'History' },
  { title: 'House Velara', cat: 'Politics' },
  { title: 'The Pale Faith', cat: 'Religion' },
  { title: 'The Drowned Coast', cat: 'Worldbuilding' },
]

const SORT_OPTIONS = [
  { value: 'category', label: 'Category' },
  { value: 'title', label: 'Title' },
  { value: 'recent', label: 'Recently added' },
] as const

// ──────────────────────────────────────────────────────────────────
// Story 1 — World characters list. Demonstrates the canonical shape.
// ──────────────────────────────────────────────────────────────────

function WorldCharactersHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof CHARACTER_FILTERS)[number]>('All')

  return (
    <View style={{ width: 340, height: 560 }} className="rounded-md border border-border">
      <EntityListPane
        kindSelector={<KindTriggerPlaceholder label="Characters" />}
        addAction={{ label: 'New character', onPress: noop }}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search characters…',
          scope: CHARACTER_SCOPE,
        }}
        filterChips={CHARACTER_FILTERS.map((label) => (
          <Chip key={label} selected={filter === label} onPress={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
        isEmpty={false}
        emptyState={null}
      >
        <ScrollView className="flex-1">
          {FAKE_CHARACTERS.map((c) => (
            <FakeListRow key={c.name} label={c.name} subtitle={c.subtitle} />
          ))}
        </ScrollView>
      </EntityListPane>
    </View>
  )
}

export const WorldCharacters: Story = {
  render: () => <WorldCharactersHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 2 — Plot, Threads / Happenings 2-way segment selector.
// ──────────────────────────────────────────────────────────────────

function PlotThreadsHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof THREAD_FILTERS)[number]>('All')
  const [kind, setKind] = useState<'threads' | 'happenings'>('threads')
  const addLabel = kind === 'threads' ? 'New thread' : 'New happening'

  return (
    <View style={{ width: 340, height: 560 }} className="rounded-md border border-border">
      <EntityListPane
        kindSelector={
          <Select
            mode="segment"
            value={kind}
            onValueChange={(v) => setKind(v as 'threads' | 'happenings')}
            options={[
              { value: 'threads', label: 'Threads' },
              { value: 'happenings', label: 'Happenings' },
            ]}
          />
        }
        addAction={{ label: addLabel, onPress: noop }}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search plot…',
          scope: THREAD_SCOPE,
        }}
        filterChips={THREAD_FILTERS.map((label) => (
          <Chip key={label} selected={filter === label} onPress={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
        isEmpty={false}
        emptyState={null}
      >
        <ScrollView className="flex-1">
          {FAKE_THREADS.map((t) => (
            <FakeListRow key={t.title} label={t.title} subtitle={t.state} />
          ))}
        </ScrollView>
      </EntityListPane>
    </View>
  )
}

export const PlotThreads: Story = {
  render: () => <PlotThreadsHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 3 — Empty state. Labeled CTA compensates for the minimalist
// [+] icon-action being too subtle on an empty pane.
// ──────────────────────────────────────────────────────────────────

function EmptyHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof CHARACTER_FILTERS)[number]>('All')

  return (
    <View style={{ width: 340, height: 560 }} className="rounded-md border border-border">
      <EntityListPane
        kindSelector={<KindTriggerPlaceholder label="Characters" />}
        addAction={{ label: 'New character', onPress: noop }}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search characters…',
          scope: CHARACTER_SCOPE,
        }}
        filterChips={CHARACTER_FILTERS.map((label) => (
          <Chip key={label} selected={filter === label} onPress={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
        isEmpty
        emptyState={
          <View className="flex-1 items-center justify-center px-6">
            <EmptyState
              title="No characters on this branch yet."
              subtext={
                <Text size="sm" variant="secondary">
                  Add the first one to start populating the world.
                </Text>
              }
            />
            <Button variant="primary" size="sm" onPress={noop}>
              <Text>+ Add your first character</Text>
            </Button>
          </View>
        }
      >
        {/* unreachable when isEmpty */}
        <View />
      </EntityListPane>
    </View>
  )
}

export const Empty: Story = {
  render: () => <EmptyHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 4 — Optional sort slot (lore list). Demonstrates passing a
// Toolbar.Sort element into the sortControl slot.
// ──────────────────────────────────────────────────────────────────

function WithSortHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof LORE_FILTERS)[number]>('All')
  const [sort, setSort] = useState('category')

  return (
    <View style={{ width: 340, height: 560 }} className="rounded-md border border-border">
      <EntityListPane
        kindSelector={<KindTriggerPlaceholder label="Lore" />}
        addAction={{ label: 'New lore entry', onPress: noop }}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search lore…',
          scope: LORE_SCOPE,
        }}
        filterChips={LORE_FILTERS.map((label) => (
          <Chip key={label} selected={filter === label} onPress={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
        sortControl={
          <Toolbar.Sort value={sort} onChange={setSort} label="Sort" options={[...SORT_OPTIONS]} />
        }
        isEmpty={false}
        emptyState={null}
      >
        <ScrollView className="flex-1">
          {FAKE_LORE.map((l) => (
            <FakeListRow key={l.title} label={l.title} subtitle={l.cat} />
          ))}
        </ScrollView>
      </EntityListPane>
    </View>
  )
}

export const WithSort: Story = {
  render: () => <WithSortHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 5 — Long list. Demonstrates that scroll containment lives in
// the body slot, not in the shell's chrome rows.
// ──────────────────────────────────────────────────────────────────

function LongListHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof CHARACTER_FILTERS)[number]>('All')
  const rows = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        name: `Character ${String(i + 1).padStart(2, '0')}`,
        subtitle: ['Active', 'Staged', 'Retired'][i % 3],
      })),
    [],
  )

  return (
    <View style={{ width: 340, height: 560 }} className="rounded-md border border-border">
      <EntityListPane
        kindSelector={<KindTriggerPlaceholder label="Characters" />}
        addAction={{ label: 'New character', onPress: noop }}
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search characters…',
          scope: CHARACTER_SCOPE,
        }}
        filterChips={CHARACTER_FILTERS.map((label) => (
          <Chip key={label} selected={filter === label} onPress={() => setFilter(label)}>
            {label}
          </Chip>
        ))}
        isEmpty={false}
        emptyState={null}
      >
        <ScrollView className="flex-1">
          {rows.map((r) => (
            <FakeListRow key={r.name} label={r.name} subtitle={r.subtitle} />
          ))}
        </ScrollView>
      </EntityListPane>
    </View>
  )
}

export const LongList: Story = {
  render: () => <LongListHarness />,
}

// ──────────────────────────────────────────────────────────────────
// Story 6 — Theme matrix. Mirrors the ScreenShell story pattern; one
// WorldCharacters pane per theme at fixed width.
// ──────────────────────────────────────────────────────────────────

function ThemePaneSample() {
  return (
    <EntityListPane
      kindSelector={<KindTriggerPlaceholder label="Characters" />}
      addAction={{ label: 'New character', onPress: noop }}
      search={{
        value: '',
        onChange: noop,
        placeholder: 'Search characters…',
        scope: CHARACTER_SCOPE,
      }}
      filterChips={CHARACTER_FILTERS.map((label, i) => (
        <Chip key={label} selected={i === 0} onPress={noop}>
          {label}
        </Chip>
      ))}
      isEmpty={false}
      emptyState={null}
    >
      <ScrollView className="flex-1">
        {FAKE_CHARACTERS.slice(0, 4).map((c) => (
          <FakeListRow key={c.name} label={c.name} subtitle={c.subtitle} />
        ))}
      </ScrollView>
    </EntityListPane>
  )
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4 p-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="gap-1"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View
            style={{ width: 340, height: 460 }}
            className="overflow-hidden rounded-md border border-border"
          >
            <ThemePaneSample />
          </View>
        </View>
      ))}
    </View>
  ),
}
