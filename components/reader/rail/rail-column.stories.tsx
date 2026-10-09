import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { TextInput, View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { EntryIndexReadProvider, type EntryIndexRead } from '@/hooks/use-entry-index'
import { t } from '@/lib/i18n'
import { DEFAULT_RAIL_VIEW, railViewFor, type RailView } from '@/lib/reader-rail'
import { appSettingsStore, entriesStore, listCollapseStore, readerRailStore } from '@/lib/stores'

import { BrowseRail } from './browse-rail'
import { RailColumn } from './rail-column'
import { railDataFixture, railFixtureTurn, readRailFixtureEntries } from './rail-story-fixtures'
import { RailStrip } from './rail-strip'
import { ReaderRailColumn } from './reader-rail-column'
import { railStripOf } from './use-rail-data'

const DATA = railDataFixture()
const STRIP = railStripOf(DATA)
const ANIMATION = { timeout: 5000 }
const OUTSIDE_FIELD = 'Composer'

function Stage({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: 560, flexDirection: 'row' }}>
      <View style={{ flex: 1, padding: 16, gap: 8 }}>
        <Text>Narrative column</Text>
        <TextInput aria-label={OUTSIDE_FIELD} className="border border-border p-2" />
      </View>
      {children}
    </View>
  )
}

const stripChevron = (strip: HTMLElement) =>
  within(strip).getByRole('button', { name: t('reader:rail.expand') })
const collapseChevron = (rail: HTMLElement) =>
  within(rail).getByRole('button', { name: t('reader:rail.collapse') })

function ColumnHarness({
  initiallyCollapsed = false,
  expandOnMount = false,
}: {
  initiallyCollapsed?: boolean
  /** Expands in the mount's own task, as a viewport cross landing with the column's mount does. */
  expandOnMount?: boolean
}) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  useLayoutEffect(() => {
    if (expandOnMount) setCollapsed(false)
  }, [expandOnMount])
  const [view, setView] = useState<RailView>(DEFAULT_RAIL_VIEW)
  return (
    <Stage>
      <RailColumn
        collapsed={collapsed}
        expanded={
          <BrowseRail
            data={DATA}
            view={view}
            onViewChange={setView}
            onCategoryChange={(category) => setView(railViewFor(category))}
            onRowPress={() => {}}
            onCollapse={() => setCollapsed(true)}
          />
        }
        strip={
          <RailStrip
            model={STRIP}
            onExpand={() => setCollapsed(false)}
            onExpandTo={() => setCollapsed(false)}
          />
        }
      />
    </Stage>
  )
}

// Storybook has no DB bridge: every preference write rejects and the display keeps the
// optimistic toggle, so these exercise the connected column on its failed-write path.
function ConnectedStage({
  isFocused = true,
  readEntries = readRailFixtureEntries,
}: {
  isFocused?: boolean
  readEntries?: EntryIndexRead
}) {
  return (
    <EntryIndexReadProvider value={readEntries}>
      <Stage>
        <ReaderRailColumn data={DATA} isFocused={isFocused} />
      </Stage>
    </EntryIndexReadProvider>
  )
}

function takeTurn(position: number) {
  entriesStore.hydrate(DATA.branchId, [railFixtureTurn(position)])
}

const columnWidth = () => screen.getByTestId('rail-column').getBoundingClientRect().width

const meta: Meta<typeof ColumnHarness> = {
  title: 'Compounds/Reader/RailColumn',
  component: ColumnHarness,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    listCollapseStore.__reset()
    readerRailStore.__reset()
    // The app's viewport watcher reports a desktop width at mount.
    readerRailStore.dispatchDisplay({ type: 'resize', width: 1200 })
    appSettingsStore.__reset()
  },
}

export default meta
type Story = StoryObj<typeof ColumnHarness>

export const Expanded: Story = {
  play: async () => {
    await expect(await screen.findByTestId('reader-rail')).toBeVisible()
    await expect(screen.queryByTestId('rail-strip')).toBeNull()
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
  },
}

export const Collapsed: Story = {
  args: { initiallyCollapsed: true },
  play: async () => {
    await expect(await screen.findByTestId('rail-strip')).toBeVisible()
    await expect(screen.queryByTestId('reader-rail')).toBeNull()
    await waitFor(() => expect(columnWidth()).toBeLessThanOrEqual(33), ANIMATION)
  },
}

/** The swap lands at the collapsed end; expanding mounts the rail at the start of the slide. */
export const Toggle: Story = {
  play: async () => {
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
    await userEvent.click(collapseChevron(screen.getByTestId('reader-rail')))
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    // Measured the moment the strip appears: the column has already narrowed to it.
    await expect(columnWidth()).toBeLessThanOrEqual(33)
    await expect(screen.queryByTestId('reader-rail')).toBeNull()

    await userEvent.click(stripChevron(strip))
    // No wait: the rail mounts with the click, before the slide has run.
    await expect(screen.queryByTestId('reader-rail')).not.toBeNull()
    await expect(screen.queryByTestId('rail-strip')).toBeNull()
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
  },
}

/** Collapsed mount, expanded in its own task: the settled slide can't bring the strip back. */
export const ExpandedRightAfterCollapsedMount: Story = {
  args: { initiallyCollapsed: true, expandOnMount: true },
  play: async () => {
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
    await expect(screen.getByTestId('reader-rail')).toBeVisible()
    await expect(screen.queryByTestId('rail-strip')).toBeNull()
  },
}

/** The chevron expands on the current category; a cell expands and switches to its kind. */
export const ConnectedStripExpands: Story = {
  render: () => <ConnectedStage />,
  beforeEach: () => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
  },
  play: async () => {
    await userEvent.click(stripChevron(await screen.findByTestId('rail-strip')))
    await screen.findByTestId('reader-rail')
    await expect(readerRailStore.getView().category).toBe('character')

    await userEvent.click(collapseChevron(screen.getByTestId('reader-rail')))
    const stripAgain = await screen.findByTestId('rail-strip', {}, ANIMATION)
    const items = STRIP.counted[1]
    await userEvent.click(
      within(stripAgain).getByRole('button', {
        name: t('reader:rail.strip.item', { count: items.count }),
      }),
    )
    await screen.findByTestId('reader-rail')
    await expect(readerRailStore.getView().category).toBe('item')
  },
}

export const ConnectedShortcutToggles: Story = {
  render: () => <ConnectedStage />,
  play: async () => {
    await screen.findByTestId('reader-rail')
    await userEvent.keyboard('{Control>}\\{/Control}')
    await screen.findByTestId('rail-strip', {}, ANIMATION)
    await userEvent.keyboard('{Control>}\\{/Control}')
    await screen.findByTestId('reader-rail', {}, ANIMATION)
  },
}

/** reader-composer.md: the shortcut toggles regardless of focus, a text field included. */
export const ConnectedShortcutFromSearchField: Story = {
  render: () => <ConnectedStage />,
  play: async () => {
    await userEvent.click(await screen.findByPlaceholderText('Search characters…'))
    await userEvent.keyboard('{Control>}\\{/Control}')
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    // The field left with the rail; focus lands on the strip's chevron, not the page.
    await waitFor(() => expect(document.activeElement).toBe(stripChevron(strip)), ANIMATION)
  },
}

/** A keyboard expand hands focus to the rail's collapse chevron. */
export const ConnectedExpandKeepsFocus: Story = {
  render: () => <ConnectedStage />,
  beforeEach: () => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
  },
  play: async () => {
    stripChevron(await screen.findByTestId('rail-strip')).focus()
    await userEvent.keyboard('{Enter}')
    const rail = await screen.findByTestId('reader-rail', {}, ANIMATION)
    await waitFor(() => expect(document.activeElement).toBe(collapseChevron(rail)), ANIMATION)
  },
}

/** A keyboard collapse hands focus to the strip's expand chevron. */
export const ConnectedCollapseKeepsFocus: Story = {
  render: () => <ConnectedStage />,
  play: async () => {
    collapseChevron(await screen.findByTestId('reader-rail')).focus()
    await userEvent.keyboard('{Enter}')
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    await waitFor(() => expect(document.activeElement).toBe(stripChevron(strip)), ANIMATION)
  },
}

/** Focus outside the column stays put whichever way the shortcut toggles. */
export const ConnectedShortcutLeavesOutsideFocus: Story = {
  render: () => <ConnectedStage />,
  play: async () => {
    await screen.findByTestId('reader-rail')
    const field = screen.getByLabelText(OUTSIDE_FIELD)
    await userEvent.click(field)
    await userEvent.keyboard('{Control>}\\{/Control}')
    await screen.findByTestId('rail-strip', {}, ANIMATION)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(document.activeElement).toBe(field)

    await userEvent.keyboard('{Control>}\\{/Control}')
    await screen.findByTestId('reader-rail', {}, ANIMATION)
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(document.activeElement).toBe(field)
  },
}

/** A collapse cut short by an expand must never land the strip. */
export const ConnectedShortcutDoublePress: Story = {
  render: () => <ConnectedStage />,
  play: async () => {
    await screen.findByTestId('reader-rail')
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
    await userEvent.keyboard('{Control>}\\{/Control}')
    await expect(readerRailStore.getDisplay().pendingCollapsed).toBe(true)
    // Inside the slide: the second toggle cuts the collapse short (it may clear to null once the
    // rejected writes settle, since it matches the stored value).
    await userEvent.keyboard('{Control>}\\{/Control}')
    await expect(readerRailStore.getDisplay().pendingCollapsed).not.toBe(true)
    // A negative check needs a settle window longer than the 150 ms slide.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await waitFor(() => expect(columnWidth()).toBeGreaterThanOrEqual(300), ANIMATION)
    await expect(screen.getByTestId('reader-rail')).toBeVisible()
    await expect(screen.queryByTestId('rail-strip')).toBeNull()
  },
}

/** A pushed-under reader keeps its column mounted; it must not answer the shortcut. */
export const ConnectedShortcutIgnoredUnfocused: Story = {
  render: () => <ConnectedStage isFocused={false} />,
  play: async () => {
    await screen.findByTestId('reader-rail')
    await userEvent.keyboard('{Control>}\\{/Control}')
    await expect(readerRailStore.getDisplay().pendingCollapsed).toBeNull()
    // A negative check needs a settle window longer than the 150 ms slide.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(screen.getByTestId('reader-rail')).toBeVisible()
    await expect(screen.queryByTestId('rail-strip')).toBeNull()
  },
}

const readPerTurn = fn<EntryIndexRead>(readRailFixtureEntries)

/** The happening list reads per turn only while mounted: a turn under the strip reads nothing. */
export const ConnectedHappeningsReadOnlyWhileExpanded: Story = {
  render: () => <ConnectedStage readEntries={readPerTurn} />,
  beforeEach: () => {
    readPerTurn.mockClear()
    readerRailStore.setCategory('happening')
    return () => entriesStore.__reset()
  },
  play: async () => {
    await screen.findByRole('button', { name: "Vorne's pact" }, ANIMATION)
    await expect(readPerTurn).toHaveBeenCalledTimes(1)
    takeTurn(61)
    await waitFor(() => expect(readPerTurn).toHaveBeenCalledTimes(2), ANIMATION)

    await userEvent.click(collapseChevron(screen.getByTestId('reader-rail')))
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    takeTurn(62)
    // A negative check: a mounted list reads within a frame of the turn.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(readPerTurn).toHaveBeenCalledTimes(2)

    await userEvent.click(stripChevron(strip))
    await waitFor(() => expect(readPerTurn).toHaveBeenCalledTimes(3), ANIMATION)
  },
}
