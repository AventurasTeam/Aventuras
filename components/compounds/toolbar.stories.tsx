import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Chip } from '@/components/ui/chip'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { Toolbar } from './toolbar'

const SORT_OPTIONS = [
  { value: 'last-opened', label: 'Last opened' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
] as const

const STORY_LIST_SCOPE = ['title', 'description', 'definition.genre.label', 'tags']

const meta: Meta<typeof Toolbar> = {
  title: 'Compounds/Toolbar',
  component: Toolbar,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <View style={{ width: 1100, padding: 16 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof Toolbar>

function FullHarness() {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'favorited' | 'archived'>('all')
  const [sort, setSort] = useState('last-opened')
  return (
    <Toolbar>
      <Toolbar.Search
        value={query}
        onChange={setQuery}
        placeholder="Search title, description…"
        scope={STORY_LIST_SCOPE}
      />
      <Toolbar.FilterChips>
        <Chip selected={filter === 'all'} onPress={() => setFilter('all')}>
          All
        </Chip>
        <Chip selected={filter === 'favorited'} onPress={() => setFilter('favorited')}>
          Favorited
        </Chip>
        <Chip selected={filter === 'archived'} onPress={() => setFilter('archived')}>
          Archived
        </Chip>
      </Toolbar.FilterChips>
      <Toolbar.Sort value={sort} onChange={setSort} label="Sort" options={[...SORT_OPTIONS]} />
    </Toolbar>
  )
}

export const FullStoryListShape: Story = {
  render: () => <FullHarness />,
}

export const SearchOnly: Story = {
  render: () => {
    const [query, setQuery] = useState('')
    return (
      <Toolbar>
        <Toolbar.Search value={query} onChange={setQuery} placeholder="Search…" scope={['name']} />
      </Toolbar>
    )
  },
}

export const SearchAndFilterChips: Story = {
  render: () => {
    const [query, setQuery] = useState('')
    const [filter, setFilter] = useState<'all' | 'staged' | 'retired'>('all')
    return (
      <Toolbar>
        <Toolbar.Search
          value={query}
          onChange={setQuery}
          placeholder="Search characters…"
          scope={['name', 'description', 'tags']}
        />
        <Toolbar.FilterChips>
          <Chip selected={filter === 'all'} onPress={() => setFilter('all')}>
            All
          </Chip>
          <Chip selected={filter === 'staged'} onPress={() => setFilter('staged')}>
            Staged
          </Chip>
          <Chip selected={filter === 'retired'} onPress={() => setFilter('retired')}>
            Retired
          </Chip>
        </Toolbar.FilterChips>
      </Toolbar>
    )
  },
}

export const NarrowContainerStacks: Story = {
  decorators: [
    (Story) => (
      <View style={{ width: 600, padding: 16 }}>
        <Story />
      </View>
    ),
  ],
  render: () => <FullHarness />,
}

export const PhoneContainer: Story = {
  decorators: [
    (Story) => (
      <View style={{ width: 360, padding: 12 }}>
        <Story />
      </View>
    ),
  ],
  render: () => <FullHarness />,
}

export const DisabledSearch: Story = {
  render: () => (
    <Toolbar>
      <Toolbar.Search
        value=""
        onChange={fn()}
        placeholder="Search…"
        scope={['name']}
        disabled
        disabledReason="Generation is in flight. Cancel to edit."
      />
      <Toolbar.FilterChips>
        <Chip selected onPress={fn()}>
          All
        </Chip>
      </Toolbar.FilterChips>
      <Toolbar.Sort value="title" onChange={fn()} label="Sort" options={[...SORT_OPTIONS]} />
    </Toolbar>
  ),
}

export const SortForcesDropdownAtThreeOptions: Story = {
  render: () => {
    const [sort, setSort] = useState('title')
    return (
      <Toolbar>
        <Toolbar.Search value="" onChange={fn()} placeholder="Search…" scope={['title']} />
        <Toolbar.Sort value={sort} onChange={setSort} label="Sort" options={[...SORT_OPTIONS]} />
      </Toolbar>
    )
  },
  play: async () => {
    // Even at 3 options (which would normally route to segment in
    // Select's cardinality cascade), Sort renders as a dropdown
    // trigger. The trigger has the chevron + selected value.
    const trigger = screen.getByRole('button', { name: /Sort: Title/ })
    expect(trigger).toBeInTheDocument()
  },
}

export const ScopeHelpOpensPopover: Story = {
  render: () => <FullHarness />,
  play: async () => {
    const help = screen.getByRole('button', { name: 'Search scope' })
    await userEvent.click(help)
    await waitFor(() => {
      expect(screen.getByText(/Searches:/)).toBeInTheDocument()
    })
  },
}

export const SearchTextChanges: Story = {
  render: () => <FullHarness />,
  play: async () => {
    const input = screen.getByPlaceholderText('Search title, description…')
    await userEvent.click(input)
    await userEvent.type(input, 'aria')
    await waitFor(() => expect(input).toHaveValue('aria'))
  },
}

export const ThemeMatrix: Story = {
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <View style={{ width: '100%' }}>
        <Story />
      </View>
    ),
  ],
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="overflow-hidden rounded-md border border-border bg-bg-base p-3"
        >
          <View className="pb-2">
            <Text variant="muted" size="xs">
              {t.name}
            </Text>
          </View>
          <Toolbar>
            <Toolbar.Search
              value=""
              onChange={fn()}
              placeholder="Search title, description…"
              scope={STORY_LIST_SCOPE}
            />
            <Toolbar.FilterChips>
              <Chip selected onPress={fn()}>
                All
              </Chip>
              <Chip onPress={fn()}>Favorited</Chip>
              <Chip onPress={fn()}>Archived</Chip>
            </Toolbar.FilterChips>
            <Toolbar.Sort
              value="last-opened"
              onChange={fn()}
              label="Sort"
              options={[...SORT_OPTIONS]}
            />
          </Toolbar>
        </View>
      ))}
    </View>
  ),
}
