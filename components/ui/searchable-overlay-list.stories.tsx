import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { Button } from './button'
import { SearchableOverlayList, type Section } from './searchable-overlay-list'
import { Text } from './text'

type Country = { name: string; capital: string }

const ALL_SECTIONS: Section<Country>[] = [
  {
    id: 'europe',
    header: 'Europe',
    sticky: true,
    rows: [
      { id: 'fr', data: { name: 'France', capital: 'Paris' } },
      { id: 'de', data: { name: 'Germany', capital: 'Berlin' } },
      { id: 'it', data: { name: 'Italy', capital: 'Rome' } },
      { id: 'es', data: { name: 'Spain', capital: 'Madrid' } },
      { id: 'cz', data: { name: 'Czechia', capital: 'Prague' } },
    ],
  },
  {
    id: 'asia',
    header: 'Asia',
    sticky: true,
    rows: [
      { id: 'jp', data: { name: 'Japan', capital: 'Tokyo' } },
      { id: 'kr', data: { name: 'South Korea', capital: 'Seoul' } },
      { id: 'th', data: { name: 'Thailand', capital: 'Bangkok' } },
      { id: 'in', data: { name: 'India', capital: 'New Delhi' } },
    ],
  },
  {
    id: 'americas',
    header: 'Americas',
    sticky: true,
    rows: [
      { id: 'us', data: { name: 'United States', capital: 'Washington, D.C.' } },
      { id: 'mx', data: { name: 'Mexico', capital: 'Mexico City' } },
      { id: 'br', data: { name: 'Brazil', capital: 'Brasília' } },
      { id: 'ar', data: { name: 'Argentina', capital: 'Buenos Aires' } },
    ],
  },
]

function filterSections(query: string): Section<Country>[] {
  if (!query) return ALL_SECTIONS
  const q = query.toLowerCase()
  return ALL_SECTIONS.map((s) => ({
    ...s,
    rows: s.rows.filter(
      (r) => r.data.name.toLowerCase().includes(q) || r.data.capital.toLowerCase().includes(q),
    ),
  })).filter((s) => s.rows.length > 0)
}

const meta: Meta<typeof SearchableOverlayList> = {
  title: 'Primitives/SearchableOverlayList',
  component: SearchableOverlayList,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof SearchableOverlayList>

function InOverlayDemo({ withFooter = false }: { withFooter?: boolean }) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Country | null>(null)
  const sections = useMemo(() => filterSections(query), [query])

  return (
    <View className="w-80 flex-col items-stretch gap-3 p-8">
      <SearchableOverlayList<Country>
        searchPlacement="in-overlay"
        ariaLabel="Country picker"
        searchPlaceholder="Search countries…"
        sections={sections}
        onQueryChange={setQuery}
        renderTrigger={(p) => (
          <Button {...p}>
            <Text>{picked ? picked.name : 'Pick a country'}</Text>
          </Button>
        )}
        renderRow={(row) => (
          <View className="flex-col">
            <Text size="sm" className="text-fg-primary">
              {row.data.name}
            </Text>
            <Text size="xs" variant="muted">
              {row.data.capital}
            </Text>
          </View>
        )}
        onActivate={(row) => setPicked(row.data)}
        renderFooter={
          withFooter
            ? () => (
                <Text size="xs" variant="muted">
                  Sticky footer slot
                </Text>
              )
            : undefined
        }
      />
      <Text variant="muted" size="xs">
        picked: {picked ? `${picked.name} (${picked.capital})` : 'nothing'}
      </Text>
    </View>
  )
}

function AsTriggerDemo() {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Country | null>(null)
  const sections = useMemo(() => filterSections(query), [query])

  return (
    <View className="w-80 flex-col items-stretch gap-3 p-8">
      <SearchableOverlayList<Country>
        searchPlacement="as-trigger"
        ariaLabel="Country combobox"
        searchPlaceholder="Type a country…"
        valueLabel={picked?.name ?? ''}
        sections={sections}
        onQueryChange={setQuery}
        renderRow={(row) => (
          <View className="flex-col">
            <Text size="sm" className="text-fg-primary">
              {row.data.name}
            </Text>
            <Text size="xs" variant="muted">
              {row.data.capital}
            </Text>
          </View>
        )}
        onActivate={(row) => setPicked(row.data)}
        onClear={() => setPicked(null)}
      />
      <Text variant="muted" size="xs">
        picked: {picked ? `${picked.name} (${picked.capital})` : 'nothing'}
      </Text>
    </View>
  )
}

export const Default: Story = { render: () => <InOverlayDemo /> }
export const AsTrigger: Story = { render: () => <AsTriggerDemo /> }
export const WithStickyFooter: Story = { render: () => <InOverlayDemo withFooter /> }

// No ThemeMatrix story — content portals to document body / Sheet, escaping per-row
// `dataSet={{theme}}` scope. Use the Storybook toolbar's global theme switcher.
