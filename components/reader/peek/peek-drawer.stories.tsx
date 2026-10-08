import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  railDataFixture,
  readRailFixtureEntries,
} from '@/components/reader/rail/rail-story-fixtures'
import type { RailData } from '@/components/reader/rail/use-rail-data'
import { pressSheetScrim } from '@/components/ui/sheet-scrim-probe'
import { Text } from '@/components/ui/text'
import { EntryIndexReadProvider } from '@/hooks/use-entry-index'
import type { HappeningAwareness, HappeningInvolvement } from '@/lib/db'
import { formatEntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { RailPeek } from '@/lib/reader-rail'
import { happeningAwarenessStore, happeningInvolvementsStore } from '@/lib/stores'

import { PeekDrawer } from './peek-drawer'

const DATA = railDataFixture()
const WITHOUT_KAEL = railDataFixture({
  entities: DATA.entities.filter((entity) => entity.id !== 'char_kael'),
})
// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 5000 }
const LANDMARK = 'Narrative under the scrim'
const KAEL: RailPeek = { category: 'character', id: 'char_kael' }
const MIRA: RailPeek = { category: 'character', id: 'char_mira' }

// The rows the harness renders; a play swaps them to delete the peeked row under the open drawer.
const harnessData = createStore<{ data: RailData }>()(() => ({ data: DATA }))

function involvement(id: string, happeningId: string, entityId: string): HappeningInvolvement {
  return { id, branchId: DATA.branchId, happeningId, entityId, role: null }
}

function awareness(id: string, happeningId: string, characterId: string): HappeningAwareness {
  return {
    id,
    branchId: DATA.branchId,
    happeningId,
    characterId,
    learnedAtEntryId: null,
    decayResistance: null,
    retrievalCount: 0,
    source: null,
  }
}

type HarnessProps = {
  initialPeek: RailPeek | null
  visible: boolean
  blocked: boolean
  blockedReason?: string
  onClose: () => void
  onOpenInPanel: (href: string) => void
}

/** Holds the peek as `readerRailStore` does: a close clears it. */
function DrawerHarness({
  initialPeek,
  visible,
  blocked,
  blockedReason,
  onClose,
  onOpenInPanel,
}: HarnessProps) {
  const data = useStore(harnessData, (s) => s.data)
  const [peek, setPeek] = useState(initialPeek)
  return (
    <EntryIndexReadProvider value={readRailFixtureEntries}>
      <View style={{ height: 640, padding: 16 }}>
        <Text>{LANDMARK}</Text>
      </View>
      <PeekDrawer
        data={data}
        visible={visible}
        peek={peek}
        storyId={null}
        blocked={blocked}
        blockedReason={blockedReason}
        onClose={() => {
          onClose()
          setPeek(null)
        }}
        onOpenInPanel={onOpenInPanel}
      />
    </EntryIndexReadProvider>
  )
}

const meta: Meta<typeof DrawerHarness> = {
  title: 'Compounds/Reader/PeekDrawer',
  component: DrawerHarness,
  parameters: { layout: 'fullscreen' },
  args: { initialPeek: KAEL, visible: true, blocked: false, onClose: fn(), onOpenInPanel: fn() },
  beforeEach: () => {
    harnessData.setState({ data: DATA })
  },
}

export default meta
type Story = StoryObj<typeof DrawerHarness>

const findDrawer = (name: string) =>
  screen.findByRole('dialog', { name: t('reader:peek.label', { name }) }, WAIT)
const queryDrawer = () => screen.queryByTestId('peek-drawer')
// A negative check waits out the Sheet's 250 ms entry.
const settle = () => new Promise((resolve) => setTimeout(resolve, 600))

/** layout.md → Sheet: right-anchored, ~440 px, one dialog named for the row. */
export const OpenOnKael: Story = {
  play: async ({ args }) => {
    const drawer = await findDrawer('Kael')
    await expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await expect(within(drawer).getByRole('heading', { name: 'Kael' })).toBeVisible()
    await expect(within(drawer).getByText(t('world:lead.you'))).toBeVisible()
    await expect(Math.round(drawer.getBoundingClientRect().width)).toBe(440)
    // Measured once the slide-in has landed against the right edge.
    await waitFor(() => {
      const right = drawer.getBoundingClientRect().right
      expect(Math.abs(right - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    }, WAIT)
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

/** Focus lands on the drawer, not on a non-lead's `Set as lead` (developer, 2026-10-08). */
export const FocusLandsOnTheDrawer: Story = {
  args: { initialPeek: MIRA },
  play: async () => {
    const drawer = await findDrawer('Mira')
    // Radix focuses its own wrapper, the named dialog's parent; the lead button is deeper.
    await waitFor(
      () => expect([drawer, drawer.parentElement]).toContain(document.activeElement),
      WAIT,
    )
    await expect(
      within(drawer).getByRole('button', { name: t('reader:peek.setLead') }),
    ).not.toHaveFocus()
  },
}

export const CloseButtonCloses: Story = {
  play: async ({ args }) => {
    const drawer = await findDrawer('Kael')
    await userEvent.click(within(drawer).getByRole('button', { name: t('reader:peek.close') }))
    await waitFor(() => expect(queryDrawer()).toBeNull(), WAIT)
    await expect(args.onClose).toHaveBeenCalledTimes(1)
  },
}

export const EscapeCloses: Story = {
  play: async ({ args }) => {
    await findDrawer('Kael')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(queryDrawer()).toBeNull(), WAIT)
    await expect(args.onClose).toHaveBeenCalledTimes(1)
  },
}

/** layout.md → Sheet behavior: tap-outside dismisses the right anchor too. */
export const ScrimPressCloses: Story = {
  play: async ({ args }) => {
    await findDrawer('Kael')
    await pressSheetScrim(screen.getByText(LANDMARK))
    await waitFor(() => expect(queryDrawer()).toBeNull(), WAIT)
    await expect(args.onClose).toHaveBeenCalledTimes(1)
  },
}

/** An Overview region routes to World on its edit tab (C6's `tab`). */
export const RegionLandsWorldTab: Story = {
  play: async ({ args }) => {
    const drawer = await findDrawer('Kael')
    await userEvent.click(within(drawer).getByTestId('overview-visual'))
    await expect(args.onOpenInPanel).toHaveBeenCalledTimes(1)
    await expect(args.onOpenInPanel).toHaveBeenLastCalledWith(
      '/world/br_1?kind=character&id=char_kael&tab=identity',
    )
  },
}

export const LorePeek: Story = {
  args: { initialPeek: { category: 'lore', id: 'lore_veil' } },
  play: async ({ args }) => {
    const drawer = await findDrawer('The Veil')
    await expect(within(drawer).getByTestId('lore-peek-body')).toBeVisible()
    await userEvent.click(within(drawer).getByRole('link', { name: t('reader:peek.openInWorld') }))
    await expect(args.onOpenInPanel).toHaveBeenLastCalledWith('/world/br_1?kind=lore&id=lore_veil')
  },
}

/** The drawer reads the link stores and the entry index above the Sheet's Portal. */
export const HappeningPeek: Story = {
  args: { initialPeek: { category: 'happening', id: 'h_ambush' } },
  beforeEach: () => {
    happeningInvolvementsStore.hydrate(DATA.branchId, [
      involvement('hi_kael', 'h_ambush', 'char_kael'),
      involvement('hi_mira', 'h_ambush', 'char_mira'),
      involvement('hi_vorne', 'h_pact', 'char_vorne'),
    ])
    happeningAwarenessStore.hydrate(DATA.branchId, [awareness('ha_mira', 'h_ambush', 'char_mira')])
    return () => {
      happeningInvolvementsStore.__reset()
      happeningAwarenessStore.__reset()
    }
  },
  play: async ({ args }) => {
    const drawer = await findDrawer('The alley ambush')
    const body = within(drawer).getByTestId('happening-peek-body')
    await waitFor(() => expect(within(body).getByText(formatEntryRef(10))).toBeVisible(), WAIT)
    await expect(body.textContent).toContain(t('reader:peek.involved', { count: 2 }))
    await expect(body.textContent).toContain(t('reader:peek.aware', { count: 1 }))
    await userEvent.click(within(drawer).getByRole('link', { name: t('reader:peek.openInPlot') }))
    await expect(args.onOpenInPanel).toHaveBeenLastCalledWith(
      '/plot/br_1?kind=happening&id=h_ambush',
    )
  },
}

/** The reader's generation gate reaches `Set as lead` with its own reason. */
export const BlockedSetAsLead: Story = {
  args: {
    initialPeek: MIRA,
    blocked: true,
    blockedReason: t('common:generationGate.chapterClose'),
  },
  play: async () => {
    const drawer = await findDrawer('Mira')
    const name = t('common:disabledWithReason', {
      label: t('reader:peek.setLead'),
      reason: t('common:generationGate.chapterClose'),
    })
    await expect(within(drawer).getByRole('button', { name })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/** A peek naming a row that isn't there opens nothing and clears itself once. */
export const RowMissingOnOpen: Story = {
  args: { initialPeek: { category: 'character', id: 'char_ghost' } },
  play: async ({ args }) => {
    await waitFor(() => expect(args.onClose).toHaveBeenCalledTimes(1), WAIT)
    await settle()
    await expect(args.onClose).toHaveBeenCalledTimes(1)
    await expect(screen.queryByRole('dialog')).toBeNull()
  },
}

/** Decision: a row deleted under the open peek closes it, and its return doesn't reopen it. */
export const RowDeletedWhileOpen: Story = {
  play: async ({ args }) => {
    await findDrawer('Kael')
    harnessData.setState({ data: WITHOUT_KAEL })
    await waitFor(() => expect(queryDrawer()).toBeNull(), WAIT)
    await expect(args.onClose).toHaveBeenCalledTimes(1)

    harnessData.setState({ data: DATA })
    await settle()
    await expect(queryDrawer()).toBeNull()
  },
}

export const Hidden: Story = {
  args: { visible: false },
  play: async ({ args }) => {
    await screen.findByText(LANDMARK)
    await settle()
    await expect(screen.queryByRole('dialog')).toBeNull()
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}
