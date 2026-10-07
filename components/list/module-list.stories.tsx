import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState, type Ref } from 'react'
import { ScrollView, View, type ScrollViewProps } from 'react-native'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { entityListModule } from '@/components/entity/entity-list-module'
import { LORE_FILTER, loreListModule } from '@/components/entity/lore-list-module'
import { ScrollComponentContext } from '@/components/ui/scroll-component'
import type { Entity, Lore } from '@/lib/db'
import type { EntityFilter, EntityListSignals } from '@/lib/list-modules'

import type { RowDensity } from './list-module'
import { ModuleList } from './module-list'

const SIGNALS: EntityListSignals = { leadId: null, inScene: new Set() }
const COLLAPSED: ReadonlySet<string> = new Set(['staged', 'retired'])
const FLAGGED: ReadonlySet<string> = new Set(['char_sage'])

function character(id: string, name: string, status: Entity['status']): Entity {
  return {
    id,
    branchId: 'br_1',
    kind: 'character',
    name,
    description: null,
    status,
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
  }
}

const CHARACTERS: Entity[] = [
  character('char_kael', 'Kael', 'active'),
  character('char_sage', 'The Ashen Sage', 'staged'),
]

const LORE: Lore[] = [
  {
    id: 'lore_veil',
    branchId: 'br_1',
    title: 'The Veil',
    body: 'A membrane between the city and what it was built to contain.',
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'always',
    priority: 10,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

type LoreHarnessProps = {
  rows?: Lore[]
  density?: RowDensity
  emptySubtext?: string
}

function LoreHarness({ rows = LORE, density, emptySubtext }: LoreHarnessProps) {
  const [search, setSearch] = useState('')
  return (
    <View style={{ width: 300, height: 400 }}>
      <ModuleList
        listModule={loreListModule}
        rows={rows}
        filter={LORE_FILTER}
        onFilterChange={() => {}}
        search={search}
        onSearchChange={setSearch}
        categoryLabel="Lore"
        kindSelector={null}
        addSlot={null}
        listSignals={SIGNALS}
        rowSignals={() => ({})}
        selectedId={null}
        onSelect={() => {}}
        collapsed={COLLAPSED}
        onCollapsedChange={() => {}}
        resetKey="lore"
        density={density}
        emptySubtext={emptySubtext}
      />
    </View>
  )
}

function CharacterHarness({ onReveal }: { onReveal?: (id: string) => void }) {
  const [filter, setFilter] = useState<EntityFilter>('all')
  const [search, setSearch] = useState('')
  return (
    <View style={{ width: 300, height: 400 }}>
      <ModuleList
        listModule={entityListModule('character')}
        rows={CHARACTERS}
        filter={filter}
        onFilterChange={setFilter}
        search={search}
        onSearchChange={setSearch}
        categoryLabel="Characters"
        kindSelector={null}
        addSlot={null}
        listSignals={SIGNALS}
        rowSignals={() => ({})}
        flagged={FLAGGED}
        selectedId={null}
        onSelect={() => {}}
        collapsed={COLLAPSED}
        onCollapsedChange={() => {}}
        onReveal={onReveal}
        resetKey="character"
      />
    </View>
  )
}

function TaggedScroll(props: ScrollViewProps & { ref?: Ref<ScrollView> }) {
  return <ScrollView {...props} testID="injected-scroll" />
}

type StoryArgs = { onReveal?: (id: string) => void }

const meta: Meta<StoryArgs> = {
  title: 'Compounds/List/ModuleList',
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<StoryArgs>

/** The default density keeps the lore row's body excerpt. */
export const DefaultDensity: Story = {
  render: () => <LoreHarness />,
  play: async () => {
    expect(await screen.findByRole('button', { name: 'The Veil' })).toBeVisible()
    expect(screen.getByText(/membrane/)).toBeInTheDocument()
  },
}

/** `density` reaches every row: compact drops the lore row's body excerpt. */
export const CompactDensity: Story = {
  render: () => <LoreHarness density="compact" />,
  play: async () => {
    expect(await screen.findByRole('button', { name: 'The Veil' })).toBeVisible()
    expect(screen.queryByText(/membrane/)).toBeNull()
  },
}

/** A surface's own subtext replaces the module's, title unchanged. */
export const EmptySubtextOverride: Story = {
  render: () => <LoreHarness rows={[]} emptySubtext="Add lore from the World panel." />,
  play: async () => {
    expect(await screen.findByText('No lore on this branch yet.')).toBeVisible()
    expect(screen.getByText('Add lore from the World panel.')).toBeVisible()
    expect(screen.queryByText('Add one with + New.')).toBeNull()
  },
}

/** Without `onReveal`, a collapsed group holding a flagged row shows no `⚠ N` badge. */
export const FlaggedWithoutReveal: Story = {
  render: () => <CharacterHarness />,
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Kael' })).toBeVisible()
    expect(screen.getByRole('button', { name: /^Staged\s*1$/ })).toBeVisible()
    expect(screen.queryByRole('button', { name: /needs? review/ })).toBeNull()
  },
}

/** With `onReveal`, the same group shows the badge, and a press reveals the flagged row. */
export const FlaggedWithReveal: Story = {
  args: { onReveal: fn() },
  render: (args) => <CharacterHarness onReveal={args.onReveal} />,
  play: async ({ args }) => {
    const badge = await screen.findByRole('button', { name: '1 in Staged needs review' })
    await userEvent.click(badge)
    expect(args.onReveal).toHaveBeenCalledWith('char_sage')
  },
}

/** A host's scroll component replaces the default one. */
export const InjectedScroll: Story = {
  render: () => (
    <ScrollComponentContext.Provider value={TaggedScroll}>
      <LoreHarness />
    </ScrollComponentContext.Provider>
  ),
  play: async () => {
    const row = await screen.findByRole('button', { name: 'The Veil' })
    expect(screen.getByTestId('injected-scroll')).toContainElement(row)
  },
}
