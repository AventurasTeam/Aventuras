import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { SearchableOverlayList, type Section } from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'

type Item = { name: string; hint: string }

const SECTIONS: Section<Item>[] = [
  {
    id: 'fruits',
    header: 'Fruits',
    sticky: true,
    rows: [
      { id: 'apple', data: { name: 'Apple', hint: 'crisp' } },
      { id: 'banana', data: { name: 'Banana', hint: 'soft' } },
      { id: 'cherry', data: { name: 'Cherry', hint: 'tart' } },
      { id: 'date', data: { name: 'Date', hint: 'sweet' } },
      { id: 'elderberry', disabled: true, data: { name: 'Elderberry', hint: 'rare' } },
      { id: 'fig', data: { name: 'Fig', hint: 'jammy' } },
    ],
  },
  {
    id: 'vegetables',
    header: 'Vegetables',
    sticky: true,
    rows: [
      { id: 'asparagus', data: { name: 'Asparagus', hint: 'green' } },
      { id: 'beet', data: { name: 'Beet', hint: 'earthy' } },
      { id: 'carrot', data: { name: 'Carrot', hint: 'crunchy' } },
      { id: 'kale', data: { name: 'Kale', hint: 'bitter' } },
    ],
  },
]

function filterSections(query: string): Section<Item>[] {
  if (!query) return SECTIONS
  const q = query.toLowerCase()
  return SECTIONS.map((s) => ({
    ...s,
    rows: s.rows.filter(
      (r) => r.data.name.toLowerCase().includes(q) || r.data.hint.toLowerCase().includes(q),
    ),
  })).filter((s) => s.rows.length > 0)
}

export default function SearchableOverlayListDevRoute() {
  const [query1, setQuery1] = useState('')
  const [picked1, setPicked1] = useState<Item | null>(null)
  const sections1 = useMemo(() => filterSections(query1), [query1])

  const [query2, setQuery2] = useState('')
  const [picked2, setPicked2] = useState<Item | null>(null)
  const sections2 = useMemo(() => filterSections(query2), [query2])

  const [query3, setQuery3] = useState('')
  const [picked3, setPicked3] = useState<Item | null>(null)
  const sections3 = useMemo(() => filterSections(query3), [query3])

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>in-overlay mode</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Consumer renders the trigger; substrate opens a Popover (desktop / tablet) or Sheet
            (phone) hosting the pinned search + virtualized sectioned list.
          </Text>
          <View className="mt-3 flex-col items-start gap-2">
            <SearchableOverlayList<Item>
              searchPlacement="in-overlay"
              ariaLabel="Pick an item"
              searchPlaceholder="Search items…"
              sections={sections1}
              onQueryChange={setQuery1}
              renderTrigger={(p) => (
                <Button {...p}>
                  <Text>{picked1 ? picked1.name : 'Pick an item'}</Text>
                </Button>
              )}
              renderRow={(row) => (
                <View className="flex-col">
                  <Text size="sm" className="text-fg-primary">
                    {row.data.name}
                  </Text>
                  <Text size="xs" variant="muted">
                    {row.data.hint}
                  </Text>
                </View>
              )}
              onActivate={(row) => setPicked1(row.data)}
            />
            <Text size="xs" variant="muted">
              picked: {picked1 ? picked1.name : 'nothing'}
            </Text>
          </View>
        </View>
        <View>
          <Heading level={3}>in-overlay with sticky footer</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            renderFooter slot pins below the list — picker uses this for the custom-add composer.
          </Text>
          <View className="mt-3 flex-col items-start gap-2">
            <SearchableOverlayList<Item>
              searchPlacement="in-overlay"
              ariaLabel="Pick an item with footer"
              searchPlaceholder="Search…"
              sections={sections2}
              onQueryChange={setQuery2}
              renderTrigger={(p) => (
                <Button {...p} variant="secondary">
                  <Text>{picked2 ? picked2.name : 'Pick (with footer)'}</Text>
                </Button>
              )}
              renderRow={(row) => (
                <Text size="sm" className="text-fg-primary">
                  {row.data.name}
                </Text>
              )}
              onActivate={(row) => setPicked2(row.data)}
              renderFooter={() => (
                <Button variant="ghost">
                  <Text>+ Custom add</Text>
                </Button>
              )}
            />
            <Text size="xs" variant="muted">
              picked: {picked2 ? picked2.name : 'nothing'}
            </Text>
          </View>
        </View>
        <View>
          <Heading level={3}>as-trigger combobox mode</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Substrate renders an Input as both the trigger and the search field. Desktop / tablet
            uses an inline portaled popup; phone opens a Sheet with a tap-proxy field.
          </Text>
          <View className="mt-3 flex-col items-start gap-2">
            <SearchableOverlayList<Item>
              searchPlacement="as-trigger"
              ariaLabel="Type to filter items"
              searchPlaceholder="Type to filter…"
              valueLabel={picked3?.name ?? ''}
              sections={sections3}
              onQueryChange={setQuery3}
              renderRow={(row) => (
                <Text size="sm" className="text-fg-primary">
                  {row.data.name}
                </Text>
              )}
              onActivate={(row) => setPicked3(row.data)}
              onClear={() => setPicked3(null)}
            />
            <Text size="xs" variant="muted">
              picked: {picked3 ? picked3.name : 'nothing'}
            </Text>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
