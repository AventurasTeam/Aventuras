import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react-native'
import { useEffect, useState, type ReactNode } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { SafeAreaInsetsContext } from 'react-native-safe-area-context'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Button } from '@/components/ui/button'
import { IconAction } from '@/components/ui/icon-action'
import { findSheetScrim, pressSheetScrim } from '@/components/ui/sheet-scrim-probe'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import {
  DEFAULT_RAIL_VIEW,
  RAIL_CATEGORIES,
  railViewFor,
  type RailCategory,
  type RailPeek,
  type RailView,
} from '@/lib/reader-rail'
import type { RecentlyClassified, RowCategory } from '@/lib/row-signals'
import { entriesStore, listCollapseStore, readerRailStore } from '@/lib/stores'

import { RAIL_MODULES, railCategoryLabel } from './rail-modules'
import { RailSheet } from './rail-sheet'
import { railDataFixture, railFixtureTurn } from './rail-story-fixtures'
import { ReaderBrowseChip } from './reader-browse-chip'
import type { RailData } from './use-rail-data'

const PHONE = { viewport: { value: 'mobile1' } }
const ANIMATION = { timeout: 5000 }

const DATA = railDataFixture()
const TINTED = railDataFixture({
  categoryTint: new Map<RowCategory, RecentlyClassified>([
    ['character', 'fresh'],
    ['lore', 'fading'],
    ['happening', 'fresh'],
  ]),
})

// The lead is pinned above the All view's groups, so its row renders whatever the collapse state.
function leadOf(data: RailData) {
  const lead = data.entities.find((entity) => entity.id === data.entityListSignals.leadId)
  if (lead == null) throw new Error('railDataFixture() must carry a lead character')
  return lead
}

// The peek stories use Mira, an active non-lead: her row sits in the Active tier, which starts open.
function entityNamed(name: string) {
  const entity = DATA.entities.find((e) => e.name === name)
  if (entity == null) throw new Error(`railDataFixture() has no entity named ${name}`)
  return entity
}

// gorhom's container fills this stage, so a detent is a share of the stage's height.
function Stage({ children }: { children: ReactNode }) {
  const { height } = useWindowDimensions()
  return (
    <View testID="rail-sheet-stage" style={{ height, padding: 16, gap: 8 }}>
      {children}
    </View>
  )
}

function renderTestPeek(peek: RailPeek, back: () => void) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <IconAction icon={ArrowLeft} label="Back to list" onPress={back} />
      <Text>{`Peek ${peek.category} ${peek.id}`}</Text>
    </View>
  )
}

type HarnessProps = {
  data?: RailData
  onRowPress?: (category: RailCategory, id: string) => void
  withPeek?: boolean
  onNavigate?: (href: string) => void
}

function SheetHarness({ data = DATA, onRowPress = () => {}, withPeek = false }: HarnessProps) {
  const [open, setOpen] = useState(true)
  const [view, setView] = useState<RailView>(DEFAULT_RAIL_VIEW)
  return (
    <Stage>
      <Button onPress={() => setOpen(true)}>
        <Text>Open rail</Text>
      </Button>
      <Button onPress={() => setOpen(false)}>
        <Text>Close rail</Text>
      </Button>
      <RailSheet
        open={open}
        onOpenChange={setOpen}
        data={data}
        view={view}
        onViewChange={setView}
        onCategoryChange={(category) =>
          setView((current) => (current.category === category ? current : railViewFor(category)))
        }
        {...(withPeek ? { renderPeek: renderTestPeek } : { onRowPress })}
      />
    </Stage>
  )
}

// The chip's data, swapped from a play: the scrim covers every button in the stage.
const chipData: { set: ((data: RailData) => void) | null } = { set: null }

function setChipData(data: RailData) {
  if (chipData.set == null) throw new Error('ChipHarness is not mounted')
  chipData.set(data)
}

function ChipHarness({ onNavigate = () => {} }: Pick<HarnessProps, 'onNavigate'>) {
  const [data, setData] = useState(DATA)
  useEffect(() => {
    chipData.set = setData
    return () => {
      chipData.set = null
    }
  }, [])
  return (
    <Stage>
      {/* Above the tall detent's top edge, where only the scrim can be: the chip sits under it. */}
      <View
        testID="scrim-landmark"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 12 }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <ReaderBrowseChip
          data={data}
          storyId={null}
          blocked={false}
          blockedReason={undefined}
          onNavigate={onNavigate}
        />
      </View>
    </Stage>
  )
}

const railDialog = () => screen.getByRole('dialog', { name: t('reader:rail.label') })
const queryRailDialog = () => screen.queryByRole('dialog', { name: t('reader:rail.label') })
const backToCategories = () =>
  screen.getByRole('button', { name: t('reader:rail.backToCategories') })
const peekBack = () => screen.getByRole('button', { name: t('reader:peek.back') })

async function headIs(category: RailCategory) {
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: railCategoryLabel(category) })).toBeVisible(),
  )
}

/** Share of the stage the Sheet covers, from its top edge (under the handle). */
function sheetCoverage(): number {
  const stage = screen.getByTestId('rail-sheet-stage').getBoundingClientRect()
  return (stage.bottom - railDialog().getBoundingClientRect().top) / stage.height
}

async function waitForMediumDetent() {
  await waitFor(() => {
    expect(sheetCoverage()).toBeGreaterThan(0.45)
    expect(sheetCoverage()).toBeLessThan(0.65)
  }, ANIMATION)
}

/** Elements from `from` up to the dialog that paint a background over the Sheet's surface. */
function paintedUpToDialog(from: HTMLElement): HTMLElement[] {
  const dialog = railDialog()
  const painted: HTMLElement[] = []
  for (let node = from.parentElement; node != null; node = node.parentElement) {
    if (getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)') painted.push(node)
    if (node === dialog) break
  }
  return painted
}

function tintOpacity(category: RailCategory): string | null {
  const layer = screen.queryByTestId(`rail-sheet-tint-${category}`)
  return layer == null ? null : getComputedStyle(layer).opacity
}

/** Presses the scrim over `under` via the probe, after asserting the scrim isn't in the Sheet. */
async function pressBackdropOver(under: HTMLElement) {
  const { scrim } = await findSheetScrim(under)
  expect(railDialog().contains(scrim)).toBe(false)
  await pressSheetScrim(under)
}

/** Waits until opening starts (the scrim fades in then): gorhom drops a dismiss sent earlier. */
async function waitForSheetOpening(landmark: HTMLElement) {
  await findSheetScrim(landmark)
}

/** Opens the chip's Sheet on the Characters list, settled at the medium detent. */
async function openChipSheet() {
  await userEvent.click(await screen.findByTestId('browse-chip'))
  await waitFor(() => expect(railDialog()).toBeVisible())
  await headIs('character')
  await waitForMediumDetent()
}

/** Taps the named list row and waits for its peek at the tall detent. */
async function peekRow(name: string) {
  await userEvent.click(screen.getByRole('button', { name }))
  await waitFor(() => expect(screen.getByRole('heading', { name })).toBeVisible())
  await waitFor(() => expect(sheetCoverage()).toBeGreaterThan(0.85), ANIMATION)
}

const openRailButton = () => screen.getByRole('button', { name: 'Open rail' })

const meta: Meta<typeof SheetHarness> = {
  title: 'Compounds/Reader/RailSheet',
  component: SheetHarness,
  parameters: { layout: 'fullscreen' },
  args: { onRowPress: fn(), onNavigate: fn() },
  beforeEach: () => {
    listCollapseStore.__reset()
    readerRailStore.__reset()
  },
}

export default meta
type Story = StoryObj<typeof SheetHarness>

export const ListLevel: Story = {
  globals: PHONE,
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('character')
    await expect(backToCategories()).toBeVisible()
    await expect(screen.getByRole('button', { name: leadOf(DATA).name })).toBeVisible()
    await expect(screen.getByText(t('reader:rail.importFromVault'))).toBeVisible()

    // Every level sits on the Sheet's own surface, so a level switch never changes the background.
    await expect(
      paintedUpToDialog(screen.getByRole('button', { name: leadOf(DATA).name })),
    ).toEqual([])
    await expect(paintedUpToDialog(screen.getByText(t('reader:rail.importFromVault')))).toEqual([])
  },
}

export const CategoriesWithTints: Story = {
  globals: PHONE,
  args: { data: TINTED },
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await userEvent.click(backToCategories())

    const characters = await screen.findByRole('button', { name: railCategoryLabel('character') })
    await expect(characters).toHaveAttribute('aria-selected', 'true')
    await expect(
      screen.getByRole('button', { name: railCategoryLabel('thread') }),
    ).not.toHaveAttribute('aria-selected', 'true')
    for (const category of RAIL_CATEGORIES) {
      await expect(screen.getByRole('button', { name: railCategoryLabel(category) })).toBeVisible()
    }
    await expect(screen.getByRole('heading', { name: t('reader:rail.groups.world') })).toBeVisible()
    await expect(screen.getByRole('heading', { name: t('reader:rail.groups.plot') })).toBeVisible()
    await expect(
      paintedUpToDialog(screen.getByRole('heading', { name: t('reader:rail.groups.world') })),
    ).toEqual([])

    await expect(tintOpacity('character')).toBe('1')
    await expect(tintOpacity('lore')).toBe('0.5')
    await expect(tintOpacity('happening')).toBe('1')
    await expect(tintOpacity('item')).toBeNull()
  },
}

export const NavigatesThroughCategories: Story = {
  globals: PHONE,
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('character')

    await userEvent.click(backToCategories())
    await userEvent.click(await screen.findByRole('button', { name: railCategoryLabel('thread') }))

    await headIs('thread')
    const threadCopy = RAIL_MODULES.thread.copy(railCategoryLabel('thread'))
    await expect(screen.getByPlaceholderText(threadCopy.searchPlaceholder)).toBeVisible()
    await expect(
      screen.queryByRole('button', { name: railCategoryLabel('lore') }),
    ).not.toBeInTheDocument()
  },
}

/** Above a nav bar the rail pads by the inset alone, not the primitive's p-6 allowance too. */
export const NavBarInset: Story = {
  globals: PHONE,
  decorators: [
    (Story) => (
      <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 48, left: 0 }}>
        <Story />
      </SafeAreaInsetsContext.Provider>
    ),
  ],
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await expect(getComputedStyle(railDialog()).paddingBottom).toBe('48px')
  },
}

/** Every opening starts on the list, whichever level the last one closed on. */
export const ReopenStartsAtList: Story = {
  globals: PHONE,
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await waitForSheetOpening(openRailButton())
    await userEvent.click(backToCategories())
    await screen.findByRole('button', { name: railCategoryLabel('lore') })

    await userEvent.click(screen.getByRole('button', { name: 'Close rail' }))
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)

    await userEvent.click(openRailButton())
    await headIs('character')
    await expect(
      screen.queryByRole('button', { name: railCategoryLabel('lore') }),
    ).not.toBeInTheDocument()
  },
}

/** Test-only C10 swap: a row press grows the one Sheet to tall, the peek's back returns it. */
export const PeekGrowsToTall: Story = {
  globals: PHONE,
  args: { withPeek: true },
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await waitForMediumDetent()

    const lead = leadOf(DATA)
    await userEvent.click(screen.getByRole('button', { name: lead.name }))
    await screen.findByText(`Peek character ${lead.id}`)
    await waitFor(() => expect(sheetCoverage()).toBeGreaterThan(0.85), ANIMATION)
    await expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    await headIs('character')
    await waitForMediumDetent()
  },
}

/** A Sheet closed on the peek reopens on the list at the medium detent, not on the peek. */
export const PeekReopenStartsAtList: Story = {
  globals: PHONE,
  args: { withPeek: true },
  play: async () => {
    await waitFor(() => expect(railDialog()).toBeVisible())
    await waitForMediumDetent()

    const lead = leadOf(DATA)
    await userEvent.click(screen.getByRole('button', { name: lead.name }))
    await screen.findByText(`Peek character ${lead.id}`)
    await waitFor(() => expect(sheetCoverage()).toBeGreaterThan(0.85), ANIMATION)

    await userEvent.click(screen.getByRole('button', { name: 'Close rail' }))
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)

    await userEvent.click(openRailButton())
    await headIs('character')
    await expect(screen.queryByText(`Peek character ${lead.id}`)).not.toBeInTheDocument()
    await waitForMediumDetent()
  },
}

export const ReaderChipOpensOnLastCategory: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  beforeEach: () => {
    readerRailStore.setCategory('lore')
  },
  play: async () => {
    const chip = await screen.findByTestId('browse-chip')
    // The fixture's per-kind tints aggregate to fresh.
    await expect(getComputedStyle(screen.getByTestId('browse-chip-tint')).opacity).toBe('1')

    await userEvent.click(chip)
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('lore')
    await expect(chip).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(backToCategories())
    await expect(
      await screen.findByRole('button', { name: railCategoryLabel('lore') }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      screen.getByRole('button', { name: railCategoryLabel('character') }),
    ).not.toHaveAttribute('aria-selected', 'true')
  },
}

/** A pick goes through the store. */
export const ReaderChipPickSetsStoreCategory: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: t('reader:rail.browse') }))
    await waitFor(() => expect(railDialog()).toBeVisible())
    await userEvent.click(backToCategories())
    await userEvent.click(await screen.findByRole('button', { name: railCategoryLabel('thread') }))

    await headIs('thread')
    await expect(readerRailStore.getView().category).toBe('thread')
  },
}

/** Filter and search edits in the Sheet land in the store, so they survive a reopen or reflow. */
export const ReaderChipViewEditsSetStoreView: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: t('reader:rail.browse') }))
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('character')

    const copy = RAIL_MODULES.character.copy(railCategoryLabel('character'))
    await userEvent.click(screen.getByRole('button', { name: copy.filterLabel('staged') }))
    await userEvent.type(screen.getByPlaceholderText(copy.searchPlaceholder), 'Vor')

    await waitFor(() =>
      expect(readerRailStore.getView()).toEqual({
        category: 'character',
        filter: 'staged',
        search: 'Vor',
      }),
    )
  },
}

/** C10 filled: a row tap grows the one Sheet to tall on that row's peek; `←` returns to the list. */
export const ReaderChipRowOpensPeek: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    await openChipSheet()
    const mira = entityNamed('Mira')
    await peekRow(mira.name)
    await expect(within(railDialog()).getByTestId('peek-content')).toBeVisible()
    await expect(
      screen.queryByRole('heading', { name: railCategoryLabel('character') }),
    ).not.toBeInTheDocument()
    await expect(screen.getAllByRole('dialog')).toHaveLength(1)

    await userEvent.click(peekBack())
    await headIs('character')
    await expect(screen.getByRole('button', { name: mira.name })).toBeVisible()
    await waitForMediumDetent()
    await expect(args.onNavigate).not.toHaveBeenCalled()
  },
}

/** The scrim dismisses the whole Sheet from the peek level, not just the peek. */
export const ReaderChipBackdropClosesPeek: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    await openChipSheet()
    await peekRow(entityNamed('Mira').name)

    await pressBackdropOver(screen.getByTestId('scrim-landmark'))
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
    await expect(args.onNavigate).not.toHaveBeenCalled()
  },
}

/** layout.md → Stacking: the Sheet dismisses, then routes; a press during the close routes nothing. */
export const ReaderChipOpenInPanelNavigatesOnce: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    await openChipSheet()
    const mira = entityNamed('Mira')
    await peekRow(mira.name)

    const openInWorld = screen.getByRole('link', { name: t('reader:peek.openInWorld') })
    await userEvent.click(openInWorld)
    await userEvent.click(openInWorld)
    await expect(args.onNavigate).toHaveBeenCalledTimes(1)
    // Spelled out rather than built by railRowHref: the expectation must not be the code under test.
    await expect(args.onNavigate).toHaveBeenCalledWith(
      `/world/${DATA.branchId}?kind=character&id=${mira.id}`,
    )
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
  },
}

/** An Overview region routes to its own World tab (M4 C6's `tab`), closing the Sheet first. */
export const ReaderChipRegionOpensItsWorldTab: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    await openChipSheet()
    const mira = entityNamed('Mira')
    await peekRow(mira.name)

    await userEvent.click(within(railDialog()).getByTestId('overview-visual'))
    await expect(args.onNavigate).toHaveBeenCalledTimes(1)
    await expect(args.onNavigate).toHaveBeenCalledWith(
      `/world/${DATA.branchId}?kind=character&id=${mira.id}&tab=identity`,
    )
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
  },
}

/** A peeked row deleted under the Sheet sends it back to the list, holding no id to reopen. */
export const ReaderChipRemovedRowReturnsToList: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async () => {
    await openChipSheet()
    const mira = entityNamed('Mira')
    await peekRow(mira.name)

    setChipData(railDataFixture({ entities: DATA.entities.filter((e) => e.id !== mira.id) }))
    await headIs('character')
    await expect(screen.queryByRole('button', { name: mira.name })).not.toBeInTheDocument()
    await expect(railDialog()).toBeVisible()
    await waitForMediumDetent()

    // An undo that restores the row lands it in the list; the peek it left can't come back.
    setChipData(DATA)
    await waitFor(() => expect(screen.getByRole('button', { name: mira.name })).toBeVisible())
    await expect(screen.queryByRole('heading', { name: mira.name })).not.toBeInTheDocument()
  },
}

/** The scrim covers the whole window, chip included, and a press on it closes the list level. */
export const ReaderChipBackdropClosesList: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    const chip = await screen.findByTestId('browse-chip')
    await userEvent.click(chip)
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('character')

    await pressBackdropOver(chip)
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
    await expect(args.onNavigate).not.toHaveBeenCalled()
  },
}

/** A scrim press closes the categories level too. */
export const ReaderChipBackdropClosesCategories: Story = {
  globals: PHONE,
  render: (args) => <ChipHarness onNavigate={args.onNavigate} />,
  play: async ({ args }) => {
    const chip = await screen.findByTestId('browse-chip')
    await userEvent.click(chip)
    await waitFor(() => expect(railDialog()).toBeVisible())
    await userEvent.click(backToCategories())
    await screen.findByRole('button', { name: railCategoryLabel('lore') })

    await pressBackdropOver(chip)
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
    await expect(args.onNavigate).not.toHaveBeenCalled()
  },
}

// The preview's client: the Sheet's content shares it, so its entry-index reads show in the cache.
const probe: { client: QueryClient | null } = { client: null }

function QueryClientProbe() {
  const client = useQueryClient()
  useEffect(() => {
    probe.client = client
  }, [client])
  return null
}

const entryIndexQueries = () =>
  probe.client?.getQueryCache().findAll({ queryKey: ['entry-index', DATA.branchId] }) ?? []
const readsAtTail = (tailId: string) =>
  entryIndexQueries().filter((query) => query.queryKey[3] === tailId)

function takeTurn(position: number) {
  entriesStore.hydrate(DATA.branchId, [railFixtureTurn(position)])
}

/** The happening list reads per turn only while the Sheet is open; closing it unmounts the list. */
export const ReaderChipClosedSheetReadsNothing: Story = {
  globals: PHONE,
  render: (args) => (
    <>
      <QueryClientProbe />
      <ChipHarness onNavigate={args.onNavigate} />
    </>
  ),
  beforeEach: () => {
    readerRailStore.setCategory('happening')
    return () => entriesStore.__reset()
  },
  play: async () => {
    const chip = await screen.findByTestId('browse-chip')
    await userEvent.click(chip)
    await waitFor(() => expect(railDialog()).toBeVisible())
    await headIs('happening')
    takeTurn(61)
    await waitFor(() => expect(readsAtTail('e_61')).toHaveLength(1), ANIMATION)
    const search = RAIL_MODULES.happening.copy(railCategoryLabel('happening')).searchPlaceholder
    await expect(screen.getByPlaceholderText(search)).toBeInTheDocument()

    await pressBackdropOver(chip)
    await waitFor(() => expect(queryRailDialog()).toBeNull(), ANIMATION)
    // Gone from the DOM, not just hidden: the role query above skips hidden elements.
    await expect(screen.queryByPlaceholderText(search)).toBeNull()
    // The observer leaves in the unmount's passive-effect cleanup, just after the DOM.
    await waitFor(
      () =>
        expect(entryIndexQueries().every((query) => query.getObserversCount() === 0)).toBe(true),
      ANIMATION,
    )
    takeTurn(62)
    // A negative check: a mounted list keys the new read within a frame of the turn.
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect(readsAtTail('e_62')).toHaveLength(0)
  },
}
