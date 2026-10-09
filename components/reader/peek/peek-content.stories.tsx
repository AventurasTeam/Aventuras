import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import type { ComponentProps, Ref } from 'react'
import { ScrollView, View } from 'react-native'
import { expect, fn, screen, userEvent, within } from 'storybook/test'

import type { GlyphKind } from '@/components/entity/entity-kind-icon'
import { PlotIcon } from '@/components/plot/plot-icon'
import { ScrollComponentContext, type ScrollComponent } from '@/components/ui/scroll-component'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { EntityOverview } from '@/components/world/overview/entity-overview'
import { formatEntryRef, indexEntryRefs, type EntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'
import type { PlotKind } from '@/lib/list-modules'
import type { LeadLabel } from '@/lib/world'

import { PeekContent } from './peek-content'
import type { PeekModel, PeekRegionPress } from './peek-model'
import { PEEK_ENTITY_CONTEXT, PEEK_LEAD_CONTROL, peekModelFixture } from './peek-story-fixtures'
import type { PeekEntryIndex } from './use-peek-view'

const WAIT = { timeout: 3000 }

function entryRef(position: number): EntryRef {
  return {
    id: `e_${position}`,
    position,
    kind: 'ai_reply',
    chapterId: null,
    excerpt: `Entry ${position}`,
  }
}

/** The happening body's entry index: read, unread, read without the ambush's e_10, or failed. */
type Entries = 'read' | 'unread' | 'dangling' | 'failed'

const ENTRY_INDEXES: Record<Entries, PeekEntryIndex> = {
  read: { state: 'ready', index: indexEntryRefs([entryRef(10), entryRef(52)]) },
  unread: { state: 'reading' },
  dangling: { state: 'ready', index: indexEntryRefs([entryRef(52)]) },
  failed: { state: 'failed' },
}

function withLeadLabel(model: PeekModel, leadLabel: LeadLabel): PeekModel {
  if (model.kind !== 'entity') throw new Error('Only an entity peek carries a lead label')
  return { ...model, leadLabel }
}

function entityOf(model: PeekModel) {
  if (model.kind !== 'entity') throw new Error('Expected an entity peek')
  return model.row
}

function loreOf(model: PeekModel) {
  if (model.kind !== 'lore') throw new Error('Expected a lore peek')
  return model.row
}

function threadOf(model: PeekModel) {
  if (model.kind !== 'thread') throw new Error('Expected a thread peek')
  return model.row
}

function happeningOf(model: PeekModel) {
  if (model.kind !== 'happening') throw new Error('Expected a happening peek')
  return model.row
}

function anchoredAt(model: PeekModel, entryId: string): PeekModel {
  if (model.kind !== 'happening') throw new Error('Only a happening peek carries an anchor')
  return { ...model, row: { ...model.row, occurredAtEntryId: entryId } }
}

const KAEL = peekModelFixture('character', 'char_kael')
const MIRA = peekModelFixture('character', 'char_mira')
const CHARTER = peekModelFixture('lore', 'lore_charter')
const OATH = peekModelFixture('thread', 't_oath')
const AMBUSH = peekModelFixture('happening', 'h_ambush')
const ECLIPSE = peekModelFixture('happening', 'h_eclipse')
const FOUNDING = peekModelFixture('happening', 'h_founding')
const LEDGER_THREAD = peekModelFixture('thread', 't_ledger')
const LEDGER_HAPPENING = peekModelFixture('happening', 'h_ledger')

const OPEN_IN_WORLD = t('reader:peek.openInWorld')
const OPEN_IN_PLOT = t('reader:peek.openInPlot')
// The ⊙ is an `img` with this name; the counts line repeats the words as text.
const CK_MARKER = t('plot:commonKnowledgeMarker')
const ENTRY_INDEX_FAILED = t('plot:entryIndexFailed')

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Enabled or disabled: a disabled action's name leads with its label, then the reason.
const SET_AS_LEAD = new RegExp(`^${escapeRegExp(t('reader:peek.setLead'))}`)

// The character regions EntityOverview renders, the side-by-side's floor.
const CHARACTER_REGIONS = [
  'overview-status',
  'overview-description',
  'overview-visual',
  'overview-traits',
  'overview-drives',
  'overview-in',
  'overview-with',
  'overview-carrying',
  'overview-tags',
  'overview-portrait',
]

type HarnessProps = {
  model: PeekModel
  chrome: 'close' | 'back'
  entries: Entries
  width: number
  height: number
  onClose: () => void
  onBack: () => void
  onSetLead: (entityId: string) => void
  onOpenInPanel: () => void
  onRegionPress: PeekRegionPress
}

function PeekHarness({
  model,
  chrome,
  entries,
  width,
  height,
  onClose,
  onBack,
  onSetLead,
  onOpenInPanel,
  onRegionPress,
}: HarnessProps) {
  return (
    <View
      style={{ width, height, maxWidth: '100%' }}
      className="border border-border bg-bg-overlay"
    >
      <PeekContent
        model={model}
        entityContext={PEEK_ENTITY_CONTEXT}
        entryIndex={ENTRY_INDEXES[entries]}
        lead={{ ...PEEK_LEAD_CONTROL, onSetLead }}
        chrome={chrome === 'close' ? { kind: 'close', onClose } : { kind: 'back', onBack }}
        onOpenInPanel={onOpenInPanel}
        onRegionPress={onRegionPress}
      />
    </View>
  )
}

const meta: Meta<typeof PeekHarness> = {
  title: 'Compounds/Reader/PeekContent',
  component: PeekHarness,
  parameters: { layout: 'padded' },
  args: {
    model: MIRA,
    chrome: 'close',
    entries: 'read',
    width: 440,
    height: 720,
    onClose: fn(),
    onBack: fn(),
    onSetLead: fn(),
    onOpenInPanel: fn(),
    onRegionPress: fn(),
  },
}

export default meta
type Story = StoryObj<typeof PeekHarness>

const findPeek = () => screen.findByTestId('peek-content', {}, WAIT)

async function expectNoLeadAffordance(root: HTMLElement) {
  const peek = within(root)
  await expect(peek.queryByRole('button', { name: SET_AS_LEAD })).toBeNull()
  await expect(peek.queryByText(t('world:lead.you'))).toBeNull()
  await expect(peek.queryByText(t('world:lead.protagonist'))).toBeNull()
}

async function pressFoot(root: HTMLElement, group: 'world' | 'plot', onOpenInPanel: () => void) {
  const [label, other] =
    group === 'world' ? [OPEN_IN_WORLD, OPEN_IN_PLOT] : [OPEN_IN_PLOT, OPEN_IN_WORLD]
  const peek = within(root)
  await expect(peek.queryByRole('link', { name: other })).toBeNull()
  await userEvent.click(peek.getByRole('link', { name: label }))
  await expect(onOpenInPanel).toHaveBeenCalledTimes(1)
}

/** Decision: a lore, thread or happening body is read-only; the foot link is the escalation. */
async function expectReadOnly(body: HTMLElement) {
  await expect(within(body).queryAllByRole('button')).toEqual([])
  await expect(within(body).queryAllByRole('link')).toEqual([])
}

function regionIds(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll('[data-testid^="overview-"]'),
    (el) => el.getAttribute('data-testid') ?? '',
  ).sort()
}

const peekHead = (root: HTMLElement) => within(root).getByTestId('peek-head')

async function expectKindGlyph(root: HTMLElement, kind: GlyphKind) {
  const glyph = within(peekHead(root)).getByRole('img', { name: t(`kinds.${kind}`) })
  await expect(glyph).toBeInTheDocument()
}

// PlotIcon has no accessible name, so the head's glyph is compared with a hidden reference.
async function expectPlotGlyph(root: HTMLElement) {
  const paths = (el: HTMLElement) => el.querySelector('svg')?.innerHTML
  const head = paths(peekHead(root))
  await expect(head).toBeTruthy()
  await expect(head).toBe(paths(screen.getByTestId('glyph-reference')))
}

// PlotIcon ignores `kind` once `icon` resolves, so each kind needs a play with and without one.
function withGlyphReference(kind: PlotKind, icon: string | null) {
  return function GlyphReference(args: HarnessProps) {
    return (
      <View>
        <PeekHarness {...args} />
        <View testID="glyph-reference" className="hidden">
          <PlotIcon kind={kind} icon={icon} />
        </View>
      </View>
    )
  }
}

// Tag doesn't expose its tone, so a chip's fill is compared with a hidden warning Tag's.
function withWarningReference(args: HarnessProps) {
  return (
    <View>
      <PeekHarness {...args} />
      <View testID="warning-reference" className="hidden">
        <Tag tone="warning">
          <Text>reference</Text>
        </Tag>
      </View>
    </View>
  )
}

function scrollAncestor(el: HTMLElement, root: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node != null && node !== root; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

function HostScroll({ ref, ...props }: ComponentProps<ScrollComponent>) {
  return <ScrollView {...props} ref={ref as Ref<ScrollView>} testID="host-scroll" />
}

/** Decision: unlike lore's ten-line clamp, a thread's or happening's description shows in full. */
async function expectUnclamped(text: HTMLElement) {
  const style = getComputedStyle(text)
  await expect(style.getPropertyValue('-webkit-line-clamp')).toBe('none')
  const lineHeight = Number.parseFloat(style.lineHeight)
  await expect(Number.isFinite(lineHeight)).toBe(true)
  await expect(text.getBoundingClientRect().height).toBeGreaterThan(4 * lineHeight)
}

/** The lead in adventure: `You` after the name, no action; × closes; visual lands Identity. */
export const CharacterLead: Story = {
  args: { model: KAEL },
  play: async ({ args }) => {
    const root = await findPeek()
    const peek = within(root)
    await expect(peek.getByRole('heading', { name: 'Kael' })).toBeVisible()
    await expect(peek.getByText(t('world:lead.you'))).toBeVisible()
    await expect(peek.queryByText(t('world:lead.protagonist'))).toBeNull()
    await expect(peek.queryByRole('button', { name: SET_AS_LEAD })).toBeNull()
    await expect(peek.queryByText(t('reader:peek.recentlyClassified'))).toBeNull()

    await userEvent.click(peek.getByTestId('overview-visual'))
    await expect(args.onRegionPress).toHaveBeenCalledTimes(1)
    await expect(args.onRegionPress).toHaveBeenLastCalledWith(entityOf(KAEL), 'identity')

    await expect(peek.queryByRole('button', { name: t('reader:peek.back') })).toBeNull()
    await userEvent.click(peek.getByRole('button', { name: t('reader:peek.close') }))
    await expect(args.onClose).toHaveBeenCalledTimes(1)
    await pressFoot(root, 'world', args.onOpenInPanel)
  },
}

/** The lead in creative mode reads `Protagonist`. */
export const CharacterLeadCreative: Story = {
  args: { model: withLeadLabel(KAEL, 'protagonist') },
  play: async () => {
    const peek = within(await findPeek())
    await expect(peek.getByText(t('world:lead.protagonist'))).toBeVisible()
    await expect(peek.queryByText(t('world:lead.you'))).toBeNull()
    await expect(peek.queryByRole('button', { name: SET_AS_LEAD })).toBeNull()
  },
}

/** A non-lead character: `Set as lead` calls C5 with its id; C1's tag marks the fresh row. */
export const CharacterCandidate: Story = {
  args: { model: MIRA },
  play: async ({ args }) => {
    const peek = within(await findPeek())
    await expect(peek.getByRole('heading', { name: 'Mira' })).toBeVisible()
    await expect(peek.getByText(t('reader:peek.recentlyClassified'))).toBeVisible()
    await expect(peek.queryByText(t('world:lead.you'))).toBeNull()
    await userEvent.click(peek.getByRole('button', { name: t('reader:peek.setLead') }))
    await expect(args.onSetLead).toHaveBeenCalledTimes(1)
    await expect(args.onSetLead).toHaveBeenLastCalledWith('char_mira')
  },
}

/** A staged character can't lead: the action is disabled and its name carries the reason. */
export const CharacterStaged: Story = {
  args: { model: peekModelFixture('character', 'char_vorne') },
  play: async ({ args }) => {
    const peek = within(await findPeek())
    const name = t('common:disabledWithReason', {
      label: t('reader:peek.setLead'),
      reason: t('world:detail.menu.setLeadInactive'),
    })
    const action = peek.getByRole('button', { name })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    // RN-Web gives a disabled Pressable pointer-events: none; dispatch the click anyway.
    await userEvent.click(action, { pointerEventsCheck: 0 })
    await expect(args.onSetLead).not.toHaveBeenCalled()
  },
}

export const Location: Story = {
  args: { model: peekModelFixture('location', 'loc_hollow') },
  play: async ({ args }) => {
    const root = await findPeek()
    await expect(within(root).getByRole('heading', { name: "Veil's Hollow" })).toBeVisible()
    await expectKindGlyph(root, 'location')
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'world', args.onOpenInPanel)
  },
}

export const Item: Story = {
  args: { model: peekModelFixture('item', 'item_blade') },
  play: async ({ args }) => {
    const root = await findPeek()
    await expect(within(root).getByRole('heading', { name: 'Courier blade' })).toBeVisible()
    await expectKindGlyph(root, 'item')
    await expect(within(root).getByText(t('reader:peek.recentlyClassified'))).toBeVisible()
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'world', args.onOpenInPanel)
  },
}

export const Faction: Story = {
  args: { model: peekModelFixture('faction', 'fac_watch') },
  play: async ({ args }) => {
    const root = await findPeek()
    await expect(within(root).getByRole('heading', { name: 'The Watch' })).toBeVisible()
    await expectKindGlyph(root, 'faction')
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'world', args.onOpenInPanel)
  },
}

/** reader-composer.md → lore peek: chips, 40 lines clamped to ten, tags, no priority. */
export const LoreClamped: Story = {
  args: { model: CHARTER },
  play: async ({ args }) => {
    const lore = loreOf(CHARTER)
    const root = await findPeek()
    const head = within(peekHead(root))
    await expect(head.getByRole('heading', { name: lore.title })).toBeVisible()
    await expectKindGlyph(root, 'lore')
    const body = within(root).getByTestId('lore-peek-body')
    const text = within(body).getByTestId('lore-peek-text')
    const style = getComputedStyle(text)
    await expect(style.getPropertyValue('-webkit-line-clamp')).toBe('10')
    const lineHeight = Number.parseFloat(style.lineHeight)
    await expect(Number.isFinite(lineHeight)).toBe(true)
    const { height } = text.getBoundingClientRect()
    await expect(height).toBeGreaterThan(9.5 * lineHeight)
    await expect(height).toBeLessThan(10.5 * lineHeight)

    await expect(within(body).getByText(t('world:overview.injectionChip.always'))).toBeVisible()
    await expect(within(body).getByText(lore.category ?? '')).toBeVisible()
    await expect(within(body).getByText(t('reader:peek.tags'))).toBeVisible()
    await expect(within(body).getByText('founding')).toBeVisible()
    await expect(root.textContent).not.toContain(t('world:lore.fields.priority'))
    await expect(root.textContent).not.toContain(String(lore.priority))
    await expectReadOnly(body)
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'world', args.onOpenInPanel)
  },
}

/** reader-composer.md → lore peek: a non-default injection mode alone earns the chip row. */
export const LoreInjectionOnly: Story = {
  args: { model: peekModelFixture('lore', 'lore_seal') },
  play: async () => {
    const body = within(await findPeek()).getByTestId('lore-peek-body')
    const chips = within(body).getByTestId('lore-peek-chips')
    await expect(within(chips).getByText(t('world:overview.injectionChip.disabled'))).toBeVisible()
  },
}

/** An `auto` lore with no category has no non-default signal, so no chip row at all. */
export const LoreNoSignals: Story = {
  args: { model: peekModelFixture('lore', 'lore_tides') },
  play: async () => {
    const body = within(await findPeek()).getByTestId('lore-peek-body')
    await expect(within(body).getByTestId('lore-peek-text')).toBeVisible()
    await expect(within(body).queryByTestId('lore-peek-chips')).toBeNull()
  },
}

/** Decision — thread peek: status, the non-default injection chip, category, full description. */
export const ThreadWithInjection: Story = {
  args: { model: OATH },
  render: withGlyphReference('thread', 'shield'),
  play: async ({ args }) => {
    const thread = threadOf(OATH)
    const root = await findPeek()
    await expect(within(root).getByRole('heading', { name: thread.title })).toBeVisible()
    await expectPlotGlyph(root)
    const body = within(root).getByTestId('thread-peek-body')
    await expect(within(body).getByText(t('plot:status.active'))).toBeVisible()
    await expect(within(body).getByText(t('world:overview.injectionChip.always'))).toBeVisible()
    await expect(within(body).getByText(thread.category ?? '')).toBeVisible()
    await expect(within(body).getByText(thread.description ?? '')).toBeVisible()
    await expectReadOnly(body)
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'plot', args.onOpenInPanel)
  },
}

/** A description several lines long at 440 px renders whole. */
export const ThreadLongDescription: Story = {
  args: { model: LEDGER_THREAD },
  render: withGlyphReference('thread', null),
  play: async () => {
    const root = await findPeek()
    await expectPlotGlyph(root)
    const body = within(root).getByTestId('thread-peek-body')
    await expectUnclamped(within(body).getByText(threadOf(LEDGER_THREAD).description ?? ''))
  },
}

/** Decision — happening peek: when-marker, category, description, involved and aware counts. */
export const HappeningAnchored: Story = {
  args: { model: AMBUSH },
  render: withGlyphReference('happening', null),
  play: async ({ args }) => {
    const row = happeningOf(AMBUSH)
    const root = await findPeek()
    await expect(within(peekHead(root)).getByRole('heading', { name: row.title })).toBeVisible()
    await expectPlotGlyph(root)
    const body = within(root).getByTestId('happening-peek-body')
    await expect(within(body).getByText(formatEntryRef(10))).toBeVisible()
    await expect(within(body).getByText(row.category ?? '')).toBeVisible()
    await expect(within(body).getByText(row.description ?? '')).toBeVisible()
    await expect(within(body).queryByRole('img', { name: CK_MARKER })).toBeNull()
    const counts = within(body).getByTestId('happening-peek-counts')
    await expect(counts).toHaveTextContent(t('reader:peek.involved', { count: 2 }))
    await expect(counts).toHaveTextContent(t('reader:peek.aware', { count: 1 }))
    await expect(counts).not.toHaveTextContent(t('reader:peek.commonKnowledge'))
    await expectReadOnly(body)
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'plot', args.onOpenInPanel)
  },
}

/** Until the entry index is read, an anchored happening shows no marker, never the dangling one. */
export const HappeningIndexUnread: Story = {
  args: { model: AMBUSH, entries: 'unread' },
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).queryByText(formatEntryRef(10))).toBeNull()
    await expect(within(body).queryByText(t('entryRefDangling'))).toBeNull()
    await expect(within(body).getByTestId('happening-peek-counts')).toHaveTextContent(
      t('reader:peek.involved', { count: 2 }),
    )
  },
}

/** The contrast to the unread index: a read index without the anchor entry says so. */
export const HappeningDanglingAnchor: Story = {
  args: { model: AMBUSH, entries: 'dangling' },
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).getByText(t('entryRefDangling'))).toBeVisible()
  },
}

/** A failed read leaves an anchor unplaced: a warning chip says so, with nothing to press. */
export const HappeningIndexFailed: Story = {
  args: { model: AMBUSH, entries: 'failed' },
  render: withWarningReference,
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    const label = within(body).getByText(ENTRY_INDEX_FAILED)
    await expect(label).toBeVisible()
    const chip = label.parentElement
    const reference = screen.getByTestId('warning-reference').firstElementChild
    if (chip == null || reference == null) throw new Error('Missing a chip to compare')
    await expect(getComputedStyle(chip).backgroundColor).toBe(
      getComputedStyle(reference).backgroundColor,
    )
    await expect(within(body).queryByText(formatEntryRef(10))).toBeNull()
    await expect(within(body).queryByText(t('entryRefDangling'))).toBeNull()
    await expectReadOnly(body)
  },
}

/** With no anchor, a failed read hides nothing, so there is nothing to warn about. */
export const HappeningUnanchoredIndexFailed: Story = {
  args: { model: LEDGER_HAPPENING, entries: 'failed' },
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).getByTestId('happening-peek-counts')).toBeVisible()
    await expect(within(body).queryByText(ENTRY_INDEX_FAILED)).toBeNull()
  },
}

/** Common knowledge: the ⊙ marker, and `Common knowledge` where the aware count would be. */
export const HappeningCommonKnowledge: Story = {
  args: { model: ECLIPSE },
  render: withGlyphReference('happening', 'eye'),
  play: async ({ args }) => {
    const root = await findPeek()
    await expectPlotGlyph(root)
    const body = within(root).getByTestId('happening-peek-body')
    await expect(within(body).getByRole('img', { name: CK_MARKER })).toBeInTheDocument()
    const counts = within(body).getByTestId('happening-peek-counts')
    await expect(counts).toHaveTextContent(t('reader:peek.involved', { count: 1 }))
    await expect(counts).toHaveTextContent(t('reader:peek.commonKnowledge'))
    await expect(counts).not.toHaveTextContent(t('reader:peek.aware', { count: 0 }))
    await expectReadOnly(body)
    await expectNoLeadAffordance(root)
    await pressFoot(root, 'plot', args.onOpenInPanel)
  },
}

/** Common knowledge with no when-marker and no category: the ⊙ still shows. */
export const HappeningCommonKnowledgeAlone: Story = {
  args: { model: peekModelFixture('happening', 'h_rumour') },
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).getByRole('img', { name: CK_MARKER })).toBeInTheDocument()
  },
}

/** A description several lines long at 440 px renders whole. */
export const HappeningLongDescription: Story = {
  args: { model: LEDGER_HAPPENING },
  play: async () => {
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expectUnclamped(within(body).getByText(happeningOf(LEDGER_HAPPENING).description ?? ''))
  },
}

/** A free-text `temporal` shows whether or not the entry index has been read. */
export const HappeningTemporal: Story = {
  args: { model: FOUNDING, entries: 'unread' },
  play: async () => {
    const row = happeningOf(FOUNDING)
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).getByText(row.temporal ?? '')).toBeVisible()
  },
}

/** `temporal` outranks the anchor, so a failed read changes nothing it shows. */
export const HappeningTemporalIndexFailed: Story = {
  args: { model: anchoredAt(FOUNDING, 'e_10'), entries: 'failed' },
  play: async () => {
    const row = happeningOf(FOUNDING)
    const body = within(await findPeek()).getByTestId('happening-peek-body')
    await expect(within(body).getByText(row.temporal ?? '')).toBeVisible()
    await expect(within(body).queryByText(ENTRY_INDEX_FAILED)).toBeNull()
  },
}

/** A long Overview scrolls inside the peek, and the foot link stays in its frame. */
export const LongBodyScrolls: Story = {
  args: { model: KAEL, height: 360 },
  play: async () => {
    const root = await findPeek()
    const scroller = scrollAncestor(within(root).getByTestId('overview-status'), root)
    if (scroller == null) throw new Error('The peek body has no scroll container')
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    const foot = within(root).getByRole('link', { name: OPEN_IN_WORLD })
    await expect(foot.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      root.getBoundingClientRect().bottom,
    )
  },
}

/** The phone Sheet's scroll component, when a host provides one, carries the body. */
export const HostScrollComponent: Story = {
  args: { model: KAEL },
  decorators: [
    (Story) => (
      <ScrollComponentContext.Provider value={HostScroll}>
        <Story />
      </ScrollComponentContext.Provider>
    ),
  ],
  play: async () => {
    const root = await findPeek()
    await expect(screen.getByTestId('host-scroll')).toContainElement(
      within(root).getByTestId('overview-status'),
    )
  },
}

/** reader-composer.md → Mobile expression: the phone peek's icon-only `←`, no `×`. */
export const PhoneCharacter: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: { model: MIRA, chrome: 'back', width: 320, height: 520 },
  play: async ({ args }) => {
    const peek = within(await findPeek())
    await expect(peek.queryByRole('button', { name: t('reader:peek.close') })).toBeNull()
    await userEvent.click(peek.getByRole('button', { name: t('reader:peek.back') }))
    await expect(args.onBack).toHaveBeenCalledTimes(1)
    await expect(args.onClose).not.toHaveBeenCalled()
  },
}

function SideBySide() {
  if (KAEL.kind !== 'entity') throw new Error('Kael peeks as an entity')
  return (
    <View className="flex-row items-start gap-4">
      <View style={{ width: 440, height: 860 }} className="border border-border bg-bg-overlay">
        <PeekContent
          model={KAEL}
          entityContext={PEEK_ENTITY_CONTEXT}
          entryIndex={ENTRY_INDEXES.unread}
          lead={PEEK_LEAD_CONTROL}
          chrome={{ kind: 'close', onClose: () => {} }}
          onOpenInPanel={() => {}}
          onRegionPress={() => {}}
        />
      </View>
      <View
        testID="world-overview-panel"
        style={{ width: 440 }}
        className="border border-border p-4"
      >
        <EntityOverview
          entity={KAEL.row}
          entities={PEEK_ENTITY_CONTEXT.entities}
          worldTime={PEEK_ENTITY_CONTEXT.worldTime}
          calendar={PEEK_ENTITY_CONTEXT.calendar}
          variant="panel"
          onRegionPress={() => {}}
        />
      </View>
    </View>
  )
}

/** reader-composer.md → same as World panel Overview: one component, same regions, at 440 px. */
export const SideBySideWithWorldOverview: Story = {
  render: () => <SideBySide />,
  play: async () => {
    const peek = await findPeek()
    const panel = screen.getByTestId('world-overview-panel')
    await expect(regionIds(peek)).toEqual(expect.arrayContaining(CHARACTER_REGIONS))
    await expect(regionIds(panel)).toEqual(regionIds(peek))
    const chip = t('world:overview.injectionChip.always')
    await expect(within(peek).getByText(chip)).toBeVisible()
    await expect(within(panel).getByText(chip)).toBeVisible()
    await expect(peek.getBoundingClientRect().width).toBeLessThanOrEqual(440)
  },
}
