import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { DEFAULT_RAIL_VIEW, railViewFor, type RailView } from '@/lib/reader-rail'
import { appSettingsStore, listCollapseStore, readerRailStore } from '@/lib/stores'

import { BrowseRail } from './browse-rail'
import { RailColumn } from './rail-column'
import { railDataFixture } from './rail-story-fixtures'
import { RailStrip } from './rail-strip'
import { ReaderRailColumn } from './reader-rail-column'

const DATA = railDataFixture()
const ANIMATION = { timeout: 5000 }

function Stage({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: 560, flexDirection: 'row' }}>
      <View style={{ flex: 1, padding: 16 }}>
        <Text>Narrative column</Text>
      </View>
      {children}
    </View>
  )
}

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
            model={DATA.strip}
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
function ConnectedStage({ isFocused = true }: { isFocused?: boolean }) {
  return (
    <Stage>
      <ReaderRailColumn data={DATA} isFocused={isFocused} onRowPress={() => {}} />
    </Stage>
  )
}

const columnWidth = () => screen.getByTestId('rail-column').getBoundingClientRect().width

const meta: Meta<typeof ColumnHarness> = {
  title: 'Compounds/Reader/RailColumn',
  component: ColumnHarness,
  parameters: { layout: 'fullscreen' },
  beforeEach: () => {
    listCollapseStore.__reset()
    readerRailStore.__reset()
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
    await userEvent.click(
      within(screen.getByTestId('reader-rail')).getByRole('button', {
        name: t('reader:rail.collapse'),
      }),
    )
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    // Measured the moment the strip appears: the column has already narrowed to it.
    await expect(columnWidth()).toBeLessThanOrEqual(33)
    await expect(screen.queryByTestId('reader-rail')).toBeNull()

    await userEvent.click(within(strip).getByRole('button', { name: t('reader:rail.expand') }))
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
    const strip = await screen.findByTestId('rail-strip')
    await userEvent.click(within(strip).getByRole('button', { name: t('reader:rail.expand') }))
    await screen.findByTestId('reader-rail')
    await expect(readerRailStore.getView().category).toBe('character')

    await userEvent.click(
      within(screen.getByTestId('reader-rail')).getByRole('button', {
        name: t('reader:rail.collapse'),
      }),
    )
    const stripAgain = await screen.findByTestId('rail-strip', {}, ANIMATION)
    const items = DATA.strip.counted[1]
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
    await screen.findByTestId('rail-strip', {}, ANIMATION)
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
