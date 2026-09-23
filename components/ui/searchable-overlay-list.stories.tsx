import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { useTier } from '@/hooks/use-tier'

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

type Item = { label: string }

const LONG_SECTIONS: Section<Item>[] = [
  {
    id: 'items',
    rows: Array.from({ length: 200 }, (_, i) => ({
      id: `item-${i}`,
      data: { label: `Item ${i}` },
    })),
  },
]
const SCROLL_TARGET_ID = 'item-150'
const SCROLL_TARGET_NAME = 'Item 150'
const SCROLL_TARGET_SELECTED = [SCROLL_TARGET_ID]

function filterLong(query: string): Section<Item>[] {
  if (!query) return LONG_SECTIONS
  return LONG_SECTIONS.map((s) => ({
    ...s,
    rows: s.rows.filter((r) => r.data.label.includes(query)),
  })).filter((s) => s.rows.length > 0)
}

const EXTRA_ROW = { id: 'item-extra', data: { label: 'Item extra' } }

function InitialScrollDemo({ initialScrollRowId }: { initialScrollRowId: string }) {
  const [query, setQuery] = useState('')
  const [withExtraRow, setWithExtraRow] = useState(false)
  const sections = useMemo(() => {
    const filtered = filterLong(query)
    return withExtraRow ? filtered.map((s) => ({ ...s, rows: [...s.rows, EXTRA_ROW] })) : filtered
  }, [query, withExtraRow])
  const tier = useTier()

  // F2 re-shapes `sections` while open without touching the query or the highlight.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') setWithExtraRow((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // min-h-screen: the phone Sheet sizes against the story root, else only as tall as the trigger.
  return (
    <View className="min-h-screen w-80 flex-col items-stretch gap-3 p-8">
      <SearchableOverlayList<Item>
        searchPlacement="in-overlay"
        ariaLabel="Item picker"
        searchPlaceholder="Search items…"
        sections={sections}
        onQueryChange={setQuery}
        selectedRowIds={SCROLL_TARGET_SELECTED}
        initialScrollRowId={initialScrollRowId}
        renderTrigger={(p) => (
          <Button {...p}>
            <Text>Pick an item</Text>
          </Button>
        )}
        renderRow={(row) => <Text size="sm">{row.data.label}</Text>}
        onActivate={() => undefined}
      />
      <Text testID="tier" variant="muted" size="xs">
        {tier}
      </Text>
    </View>
  )
}

// Retried because the virtualizer settles over several frames (measured rows shift
// the target's offset); the timeout covers CI running plays several times slower.
async function expectRowCentered(name: string) {
  await waitFor(
    async () => {
      const listbox = screen.getByRole('listbox')
      const row = screen.getByRole('option', { name })
      const box = listbox.getBoundingClientRect()
      const rect = row.getBoundingClientRect()
      const center = (rect.top + rect.bottom) / 2
      await expect(center).toBeGreaterThan(box.top + box.height / 3)
      await expect(center).toBeLessThan(box.top + (2 * box.height) / 3)
    },
    { timeout: 5000 },
  )
}

// The phone Sheet's padding settles over several frames after the row centers; a
// manual scroll before then races the virtualizer's own re-targeting.
async function waitForStableHeight(el: HTMLElement) {
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))
  await waitFor(
    async () => {
      const before = el.clientHeight
      await nextFrame()
      await nextFrame()
      await expect(el.clientHeight).toBe(before)
    },
    { timeout: 5000 },
  )
}

async function playInitialScroll({ phone }: { phone: boolean }) {
  // A tier-specific render has to land before the trigger is pressed
  // (lessons-learned/storybook-viewport-usetier-async.md).
  await waitFor(() =>
    expect(screen.getByTestId('tier')).toHaveTextContent(phone ? 'phone' : 'desktop'),
  )
  const trigger = screen.getByRole('button', { name: 'Pick an item' })
  await userEvent.click(trigger)
  await expectRowCentered(SCROLL_TARGET_NAME)

  // Initial scroll is not the keyboard cursor: nothing is highlighted on open.
  const search = screen.getByPlaceholderText('Search items…')
  await expect(search).not.toHaveAttribute('aria-activedescendant')
  await expect(screen.getByRole('option', { name: SCROLL_TARGET_NAME })).toHaveAttribute(
    'aria-selected',
    'true',
  )

  // The user scrolls away, then `sections` change: a re-fired initial scroll would drag
  // the list back. A negative check needs a settle window.
  const listbox = screen.getByRole('listbox')
  await waitForStableHeight(listbox)
  listbox.scrollTop = 0
  await waitFor(() => expect(screen.getByRole('option', { name: 'Item 0' })).toBeVisible())
  await userEvent.keyboard('{F2}')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await expect(listbox.scrollTop).toBe(0)
  await expect(screen.queryByRole('option', { name: SCROLL_TARGET_NAME })).toBeNull()

  // Typing still drives the list: "1" keeps the target listed ~60 rows down, but the
  // query's auto-highlight lands on "Item 1" at the top.
  await userEvent.type(search, '1')
  await waitFor(async () => {
    await expect(search).toHaveValue('1')
    await expect(search).toHaveAttribute('aria-activedescendant')
    await expect(screen.getByRole('option', { name: 'Item 1' })).toBeVisible()
    await expect(listbox.scrollTop).toBe(0)
  })

  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  await userEvent.click(trigger)
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'))
  await expectRowCentered(SCROLL_TARGET_NAME)
}

export const InitialScrollRow: Story = {
  render: () => <InitialScrollDemo initialScrollRowId={SCROLL_TARGET_ID} />,
  play: () => playInitialScroll({ phone: false }),
}

export const InitialScrollRowPhone: Story = {
  globals: { viewport: { value: 'mobile1' } },
  render: () => <InitialScrollDemo initialScrollRowId={SCROLL_TARGET_ID} />,
  play: () => playInitialScroll({ phone: true }),
}

export const InitialScrollRowAbsent: Story = {
  render: () => <InitialScrollDemo initialScrollRowId="item-999" />,
  play: async () => {
    await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent('desktop'))
    await userEvent.click(screen.getByRole('button', { name: 'Pick an item' }))
    await expect(await screen.findByRole('option', { name: 'Item 0' })).toBeVisible()
    await expect(screen.getByRole('listbox').scrollTop).toBe(0)
  },
}

function AsTriggerInitialScrollDemo() {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => filterLong(query), [query])
  const tier = useTier()

  return (
    <View className="min-h-screen w-80 flex-col items-stretch gap-3 p-8">
      <SearchableOverlayList<Item>
        searchPlacement="as-trigger"
        ariaLabel="Item combobox"
        searchPlaceholder="Type an item…"
        sections={sections}
        onQueryChange={setQuery}
        selectedRowIds={SCROLL_TARGET_SELECTED}
        initialScrollRowId={SCROLL_TARGET_ID}
        renderRow={(row) => <Text size="sm">{row.data.label}</Text>}
        onActivate={() => undefined}
      />
      <Text testID="tier" variant="muted" size="xs">
        {tier}
      </Text>
    </View>
  )
}

// Opening via typing must not arm the initial scroll — "x" matches nothing, so no highlight
// would mask a re-arm; the veto covers that keystroke-open only, not a later focus-open.
export const InitialScrollRowAsTriggerTypingDrops: Story = {
  render: () => <AsTriggerInitialScrollDemo />,
  play: async () => {
    await waitFor(() => expect(screen.getByTestId('tier')).toHaveTextContent('desktop'))
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await expectRowCentered(SCROLL_TARGET_NAME)

    await userEvent.type(input, 'x')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'))

    await userEvent.keyboard('{Backspace}')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'))
    await expect(await screen.findByRole('option', { name: 'Item 0' })).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(screen.getByRole('listbox').scrollTop).toBe(0)
    await expect(screen.queryByRole('option', { name: SCROLL_TARGET_NAME })).toBeNull()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'false'))
    await expect(input).toHaveValue('')
    await userEvent.tab()
    await waitFor(() => expect(input).not.toHaveFocus())
    await userEvent.click(input)
    await waitFor(() => expect(input).toHaveAttribute('aria-expanded', 'true'))
    await expectRowCentered(SCROLL_TARGET_NAME)
  },
}

export const Default: Story = { render: () => <InOverlayDemo /> }
export const AsTrigger: Story = { render: () => <AsTriggerDemo /> }
export const WithStickyFooter: Story = { render: () => <InOverlayDemo withFooter /> }

// No ThemeMatrix story — content portals to document body / Sheet, escaping per-row
// `dataSet={{theme}}` scope. Use the Storybook toolbar's global theme switcher.
