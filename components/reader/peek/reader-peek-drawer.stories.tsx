import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import {
  railDataFixture,
  readRailFixtureEntries,
} from '@/components/reader/rail/rail-story-fixtures'
import { ReaderRailColumn } from '@/components/reader/rail/reader-rail-column'
import { Text } from '@/components/ui/text'
import { EntryIndexReadProvider } from '@/hooks/use-entry-index'
import { APP_SETTINGS_DEFAULTS } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { RailPeek } from '@/lib/reader-rail'
import {
  appSettingsStore,
  hydrateAppSettings,
  listCollapseStore,
  readerRailStore,
} from '@/lib/stores'

import { ReaderPeekDrawer } from './reader-peek-drawer'

const DATA = railDataFixture()
// CI runs plays several times slower than local; every post-interaction wait uses this.
const ANIMATION = { timeout: 5000 }
const MIRA: RailPeek = { category: 'character', id: 'char_mira' }
const navigate = fn<(href: string) => void>()

// Storybook has no DB bridge: every preference write rejects and the display keeps the
// optimistic toggle, as rail-column.stories.tsx's connected stories note.
function ConnectedHarness({ isFocused }: { isFocused: boolean }) {
  return (
    <EntryIndexReadProvider value={readRailFixtureEntries}>
      <View style={{ height: 560, flexDirection: 'row' }}>
        <View style={{ flex: 1, padding: 16 }}>
          <Text>Narrative column</Text>
        </View>
        <ReaderRailColumn data={DATA} isFocused={isFocused} />
        <ReaderPeekDrawer
          data={DATA}
          isFocused={isFocused}
          storyId={null}
          blocked={false}
          blockedReason={undefined}
          onNavigate={navigate}
        />
      </View>
    </EntryIndexReadProvider>
  )
}

const meta: Meta<typeof ConnectedHarness> = {
  title: 'Compounds/Reader/ReaderPeekDrawer',
  component: ConnectedHarness,
  parameters: { layout: 'fullscreen' },
  args: { isFocused: true },
  beforeEach: () => {
    listCollapseStore.__reset()
    readerRailStore.__reset()
    appSettingsStore.__reset()
    navigate.mockReset()
  },
}

export default meta
type Story = StoryObj<typeof ConnectedHarness>

const peekLabel = (name: string) => t('reader:peek.label', { name })
const queryDrawer = () => screen.queryByTestId('peek-drawer')
// A negative check waits out the 150 ms rail slide and the Sheet's 250 ms entry.
const settle = () => new Promise((resolve) => setTimeout(resolve, 600))

async function openMira(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Mira' }, ANIMATION))
  return screen.findByRole('dialog', { name: peekLabel('Mira') }, ANIMATION)
}

/** reader-composer.md → Peek drawer: a rail row opens the peek on that row. */
export const RowOpensPeek: Story = {
  play: async () => {
    const drawer = await openMira()
    await expect(within(drawer).getByRole('heading', { name: 'Mira' })).toBeVisible()
    await expect(readerRailStore.getDisplay().peek).toEqual(MIRA)
    await expect(screen.getByTestId('reader-rail')).toBeInTheDocument()
    await expect(navigate).not.toHaveBeenCalled()
  },
}

/** layout.md → Stacking: `Open in World panel →` closes the peek, then routes once. */
export const OpenInPanelClosesThenRoutes: Story = {
  play: async () => {
    const peekAtNavigate: (RailPeek | null)[] = []
    navigate.mockImplementation(() => {
      peekAtNavigate.push(readerRailStore.getDisplay().peek)
    })
    const drawer = await openMira()
    await userEvent.click(within(drawer).getByRole('link', { name: t('reader:peek.openInWorld') }))
    await expect(navigate).toHaveBeenCalledTimes(1)
    await expect(navigate).toHaveBeenLastCalledWith('/world/br_1?kind=character&id=char_mira')
    await expect(peekAtNavigate).toEqual([null])
    await waitFor(() => expect(queryDrawer()).toBeNull(), ANIMATION)
  },
}

/** The shortcut answers from inside the drawer's focus trap; the collapse closes both. */
export const ShortcutInsideDrawerClosesBoth: Story = {
  play: async () => {
    const drawer = await openMira()
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true), ANIMATION)
    await userEvent.keyboard('{Control>}\\{/Control}')
    await screen.findByTestId('rail-strip', {}, ANIMATION)
    await waitFor(() => expect(queryDrawer()).toBeNull(), ANIMATION)
    await expect(readerRailStore.getDisplay().peek).toBeNull()
  },
}

/** A viewport-forced collapse closes the peek with the rail. */
export const ViewportCollapseClosesPeek: Story = {
  play: async () => {
    await openMira()
    readerRailStore.dispatchDisplay({ type: 'resize', width: 800 })
    await screen.findByTestId('rail-strip', {}, ANIMATION)
    await waitFor(() => expect(queryDrawer()).toBeNull(), ANIMATION)
    await expect(readerRailStore.getDisplay().peek).toBeNull()
  },
}

/** Collapsed: an open sent straight to the store is refused, and no drawer shows. */
export const CollapsedRefusesPeek: Story = {
  beforeEach: () => {
    readerRailStore.dispatchDisplay({ type: 'setCollapsed', collapsed: true })
  },
  play: async () => {
    await screen.findByTestId('rail-strip', {}, ANIMATION)
    readerRailStore.dispatchDisplay({ type: 'openPeek', peek: MIRA, storedCollapsed: false })
    await settle()
    await expect(readerRailStore.getDisplay().peek).toBeNull()
    await expect(queryDrawer()).toBeNull()
  },
}

/** A preference flipped outside the rail (a settings import) closes the peek for good. */
export const PreferenceFlipClosesPeek: Story = {
  play: async () => {
    await openMira()
    await hydrateAppSettings(async () => ({
      ...APP_SETTINGS_DEFAULTS,
      appearance: { ...APP_SETTINGS_DEFAULTS.appearance, readerRailCollapsed: true },
    }))
    const strip = await screen.findByTestId('rail-strip', {}, ANIMATION)
    await waitFor(() => expect(queryDrawer()).toBeNull(), ANIMATION)
    await expect(readerRailStore.getDisplay().peek).toBeNull()

    await userEvent.click(within(strip).getByRole('button', { name: t('reader:rail.expand') }))
    await screen.findByTestId('reader-rail', {}, ANIMATION)
    await settle()
    await expect(queryDrawer()).toBeNull()
  },
}

/** lessons-learned → Portaled overlays outlive screen focus: an unfocused reader shows no drawer. */
export const UnfocusedShowsNoDrawer: Story = {
  args: { isFocused: false },
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Mira' }, ANIMATION))
    await expect(readerRailStore.getDisplay().peek).toEqual(MIRA)
    await settle()
    await expect(queryDrawer()).toBeNull()
  },
}
