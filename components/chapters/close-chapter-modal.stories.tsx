import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { formatEntryRef } from '@/lib/entry-refs'
import { t } from '@/lib/i18n'

import {
  CloseChapterModalView,
  type CloseChapterModalViewProps,
  type CloseModalRow,
} from './close-chapter-modal-view'

const START: NonNullable<CloseChapterModalViewProps['start']> = {
  id: 'entry_59',
  ref: formatEntryRef(59),
  excerpt: 'Aria sets the lantern down on the toll house step and listens for the ferry.',
  time: 'Day 7 · 06:42',
  endedChapterNumber: 2,
}

// Newest first, as the connected body hands them over; entry 67 has no world time.
const REPLIES: CloseModalRow[] = [
  {
    id: 'entry_71',
    ref: formatEntryRef(71),
    excerpt:
      'She stops at the threshold, one hand on the cold iron of the gate, and does not look back at the river.',
    time: 'Day 9 · 22:18',
  },
  {
    id: 'entry_69',
    ref: formatEntryRef(69),
    excerpt: 'The guard lifts his lantern to the seal and weighs the letter against his trouble.',
    time: 'Day 9 · 20:05',
  },
  {
    id: 'entry_67',
    ref: formatEntryRef(67),
    excerpt: 'Tobin poles wide of the usual landing, and says nothing about the light.',
    time: null,
  },
  {
    id: 'entry_65',
    ref: formatEntryRef(65),
    excerpt: 'The boat rocks as you settle, and the lamps of the town shrink behind you.',
    time: 'Day 9 · 18:40',
  },
  {
    id: 'entry_63',
    ref: formatEntryRef(63),
    excerpt: 'He squints at the wax and names a price that would buy the boat twice over.',
    time: 'Day 9 · 18:10',
  },
  {
    id: 'entry_61',
    ref: formatEntryRef(61),
    excerpt: 'The landing is a black line of planks over black water.',
    time: 'Day 9 · 17:55',
  },
]

// The running total through each reply, as tokensThrough reads the series.
const TOKENS_THROUGH: Record<string, number> = {
  entry_71: 14_200,
  entry_69: 12_950,
  entry_67: 11_400,
  entry_65: 9_850,
  entry_63: 8_100,
  entry_61: 6_300,
}

function manyReplies(
  count: number,
  { time = null, offset = 0 }: { time?: string | null; offset?: number } = {},
): CloseModalRow[] {
  return Array.from({ length: count }, (_, i) => {
    const position = offset + 2 * (count - i) + 1
    return {
      id: `entry_${position}`,
      ref: formatEntryRef(position),
      excerpt: `Reply ${position}: the road goes on through the reeds, and the lantern holds.`,
      time,
    }
  })
}

type HarnessProps = Omit<CloseChapterModalViewProps, 'selectedId' | 'tokensInRange'> & {
  initialSelectedId: string | null
}

// The view is controlled; the harness holds the pick and its count, as the connected body does.
function ModalHarness({ initialSelectedId, onSelect, ...props }: HarnessProps) {
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  return (
    <CloseChapterModalView
      {...props}
      selectedId={selectedId}
      tokensInRange={selectedId == null ? 0 : (TOKENS_THROUGH[selectedId] ?? 0)}
      onSelect={(entryId) => {
        setSelectedId(entryId)
        onSelect(entryId)
      }}
    />
  )
}

const GATE_EVENT = 'close-modal-gate'

// A play flips the gate by event, the way a run starting under the open dialog would.
function GatedHarness(props: HarnessProps) {
  const [gated, setGated] = useState(false)
  useEffect(() => {
    const raise = () => setGated(true)
    window.addEventListener(GATE_EVENT, raise)
    return () => window.removeEventListener(GATE_EVENT, raise)
  }, [])
  return (
    <ModalHarness
      {...props}
      disabledReason={gated ? t('generationGate.inFlight') : props.disabledReason}
    />
  )
}

const meta = {
  title: 'Compounds/Chapters/CloseChapterModal',
  component: ModalHarness,
  parameters: {
    layout: 'fullscreen',
    // No built-in key is 390 px wide, and an unknown key silently falls back to desktop.
    viewport: {
      options: {
        phone390: {
          name: 'Phone 390',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
        phone320: {
          name: 'Phone 320',
          styles: { width: '320px', height: '700px' },
          type: 'mobile',
        },
        phone360: {
          name: 'Phone 360',
          styles: { width: '360px', height: '800px' },
          type: 'mobile',
        },
        tablet640: {
          name: 'Tablet 640',
          styles: { width: '640px', height: '900px' },
          type: 'tablet',
        },
        phoneShort: {
          name: 'Phone 390, short',
          styles: { width: '390px', height: '700px' },
          type: 'mobile',
        },
      },
    },
  },
  args: {
    open: true,
    start: START,
    replies: REPLIES,
    latestId: 'entry_71',
    initialSelectedId: 'entry_71',
    onSelect: fn(),
    onConfirm: fn(),
    onCancel: fn(),
  },
} satisfies Meta<typeof ModalHarness>

export default meta
type Story = StoryObj<typeof meta>

const PANEL_MAX = 320

// The dialog fades in over 200 ms, so a visibility check taken at once reads it as transparent.
async function dialog() {
  const shown = await screen.findByRole('dialog', { name: t('chapters:closeModal.title') })
  await waitFor(() => expect(shown).toBeVisible())
  return shown
}
const trigger = () => screen.getByTestId('close-chapter-picker')
const startRow = () => screen.getByTestId('close-chapter-start')
const tokens = () => screen.getByTestId('close-chapter-tokens')
const panel = () => screen.queryByRole('listbox', { name: t('chapters:closeModal.endHeading') })
const confirm = () => screen.getByRole('button', { name: t('chapters:closeModal.confirm') })
const optionRefs = () =>
  within(panel()!)
    .getAllByRole('option')
    .map((option) => within(option).getByText(/^entry #\d+$/).textContent)

// On screen and the topmost paint at its centre, so nothing covers it.
function expectReachable(element: HTMLElement) {
  const box = element.getBoundingClientRect()
  expect(box.top).toBeGreaterThanOrEqual(0)
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  const top = document.elementFromPoint(
    Math.floor(box.left + box.width / 2),
    Math.floor(box.top + box.height / 2),
  )
  expect(element === top || element.contains(top)).toBe(true)
}

type RowsArgs = {
  start: NonNullable<CloseChapterModalViewProps['start']>
  replies: CloseModalRow[]
  latestId: string
}

const PHONE_ARGS = {
  start: { ...START, endedChapterNumber: 12 },
  replies: manyReplies(40, { time: 'Day 9 · 22:18' }),
  latestId: 'entry_81',
  initialSelectedId: 'entry_81',
} satisfies RowsArgs & { initialSelectedId: string }

// The longest labels a row meets: a 4-digit ref, the long tag, and a time chip on both rows.
const FOUR_DIGIT_ARGS = {
  start: {
    ...START,
    id: 'entry_1059',
    ref: formatEntryRef(1059),
    endedChapterNumber: 12,
  },
  replies: manyReplies(40, { time: 'Day 113 · 22:18', offset: 1000 }),
  latestId: 'entry_1081',
  initialSelectedId: 'entry_1081',
} satisfies RowsArgs & { initialSelectedId: string }

// Canon's narrowest window (responsive.md): the start row's ref and tag no longer share a line.
const NARROWEST_ARGS = {
  start: {
    ...START,
    id: 'entry_5123',
    ref: formatEntryRef(5123),
    endedChapterNumber: 123,
  },
  replies: manyReplies(40, { time: 'Day 113 · 22:18', offset: 5000 }),
  latestId: 'entry_5081',
  initialSelectedId: 'entry_5081',
} satisfies RowsArgs & { initialSelectedId: string }

// chapter-timeline.md → Mobile expression: labels stay whole inside the row's card, the snippet
// keeps a readable width. Phone stacks ref and tag over snippet and time; wider tiers one line.
function expectRowLegible(
  card: HTMLElement,
  {
    row,
    tag,
    layout,
    minSnippet,
  }: { row: CloseModalRow; tag: string; layout: 'two-line' | 'one-line'; minSnippet: number },
) {
  const box = card.getBoundingClientRect()
  for (const element of Array.from(card.querySelectorAll('*'))) {
    const rect = element.getBoundingClientRect()
    expect(rect.right).toBeLessThanOrEqual(box.right + 1)
    expect(rect.left).toBeGreaterThanOrEqual(box.left - 1)
  }
  const label = within(card).getByText(tag, { exact: true })
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth)
  expectOneLineLabel(label)
  const snippet = within(card).getByText(row.excerpt, { exact: true })
  expect(snippet.getBoundingClientRect().width).toBeGreaterThanOrEqual(minSnippet)
  const time = within(card).getByText(row.time!, { exact: true })
  // Right-aligned: padding and border only, plus the trigger's chevron when the row is one line.
  expect(box.right - time.getBoundingClientRect().right).toBeLessThanOrEqual(
    layout === 'two-line' ? 24 : 40,
  )
  if (layout === 'two-line') {
    // Below every label of the first line, wherever the tag wrapped to.
    for (const first of [within(card).getByText(row.ref, { exact: true }), label]) {
      expect(snippet.getBoundingClientRect().top).toBeGreaterThanOrEqual(
        first.getBoundingClientRect().bottom - 1,
      )
    }
  } else {
    expect(snippet.getBoundingClientRect().top).toBeLessThan(
      within(card).getByText(row.ref, { exact: true }).getBoundingClientRect().bottom,
    )
  }
}

function expectOneLineLabel(label: HTMLElement) {
  const lineHeight = parseFloat(getComputedStyle(label).lineHeight)
  expect(label.getBoundingClientRect().height).toBeLessThan(lineHeight * 1.5)
}

// The panel's head wraps whole at the narrowest widths: no label splits, nothing leaves the option.
async function expectLatestOptionWhole(row: CloseModalRow) {
  await userEvent.click(trigger())
  const option = await screen.findByTestId(`close-chapter-reply-${row.id}`)
  expectOneLineLabel(within(option).getByText(row.ref, { exact: true }))
  expectOneLineLabel(within(option).getByText(row.time!, { exact: true }))
  expect(option.scrollWidth).toBeLessThanOrEqual(option.clientWidth)
}

async function expectRowsLegible(
  { start, replies, latestId }: RowsArgs,
  layout: 'two-line' | 'one-line',
  minSnippet: number,
) {
  await dialog()
  const selected = replies.find((row) => row.id === latestId)!
  const startTag = t('chapters:closeModal.chapterEndedHere', { number: start.endedChapterNumber! })
  await waitFor(() =>
    expectRowLegible(startRow(), { row: start, tag: startTag, layout, minSnippet }),
  )
  await waitFor(() =>
    expectRowLegible(trigger(), {
      row: selected,
      tag: t('chapters:closeModal.latest'),
      layout,
      minSnippet,
    }),
  )
}

const PHONE_SNIPPET_MIN = 120
const PHONE_SNIPPET_MIN_NARROWEST = 80

export const Default: Story = {
  play: async ({ args }) => {
    const shown = await dialog()
    await expect(shown).toHaveAccessibleDescription(
      t('chapters:closeModal.framing', { start: START.ref }),
    )
    await expect(within(startRow()).getByText(formatEntryRef(59))).toBeVisible()
    await expect(
      within(startRow()).getByText(t('chapters:closeModal.chapterEndedHere', { number: 2 })),
    ).toBeVisible()
    // The default is the latest reply, tagged.
    await expect(within(trigger()).getByText(formatEntryRef(71))).toBeVisible()
    await expect(within(trigger()).getByText(t('chapters:closeModal.latest'))).toBeVisible()
    await expect(tokens()).toHaveTextContent('14,200 tokens in range')
    expect(panel()).toBeNull()

    await userEvent.click(confirm())
    await expect(args.onConfirm).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: t('chapters:closeModal.cancel') }))
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
}

export const PanelListsReplies: Story = {
  play: async () => {
    await dialog()
    await userEvent.click(trigger())
    await waitFor(() => expect(panel()).not.toBeNull())
    await expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    await expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox')
    expect(optionRefs()).toEqual([71, 69, 67, 65, 63, 61].map(formatEntryRef))
    const [latest] = within(panel()!).getAllByRole('option')
    await expect(latest).toHaveAttribute('aria-selected', 'true')
  },
}

export const PickUpdatesTheTriggerAndCount: Story = {
  play: async ({ args }) => {
    await dialog()
    await userEvent.click(trigger())
    await userEvent.click(await screen.findByTestId('close-chapter-reply-entry_65'))
    await expect(args.onSelect).toHaveBeenCalledWith('entry_65')
    await waitFor(() => expect(panel()).toBeNull())
    await expect(within(trigger()).getByText(formatEntryRef(65))).toBeVisible()
    expect(within(trigger()).queryByText(t('chapters:closeModal.latest'))).toBeNull()
    await expect(tokens()).toHaveTextContent('9,850 tokens in range')
    // The tint and aria-selected follow the pick, not the latest.
    await userEvent.click(trigger())
    await expect(await screen.findByTestId('close-chapter-reply-entry_65')).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(screen.getByTestId('close-chapter-reply-entry_71')).toHaveAttribute(
      'aria-selected',
      'false',
    )
  },
}

// Focus goes back to the trigger, not to the dialog the removed option leaves it on (overlays.md).
export const KeyboardPickReturnsFocus: Story = {
  play: async ({ args }) => {
    await dialog()
    await userEvent.click(trigger())
    const option = await screen.findByTestId('close-chapter-reply-entry_65')
    option.focus()
    await expect(option).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledWith('entry_65')
    await waitFor(() => expect(panel()).toBeNull())
    await expect(trigger()).toHaveFocus()
  },
}

// The listbox's own keys: the oldest reply starts virtualized out, so End scrolls it in to focus it.
export const ArrowKeysMoveBetweenReplies: Story = {
  args: { replies: manyReplies(200), latestId: 'entry_401', initialSelectedId: 'entry_401' },
  play: async ({ args }) => {
    await dialog()
    await userEvent.click(trigger())
    const reply = (id: string) => screen.getByTestId(`close-chapter-reply-${id}`)
    ;(await screen.findByTestId('close-chapter-reply-entry_401')).focus()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(reply('entry_399')).toHaveFocus())
    await userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(reply('entry_401')).toHaveFocus())
    await userEvent.keyboard('{ArrowUp}')
    await expect(reply('entry_401')).toHaveFocus()
    expect(screen.queryByTestId('close-chapter-reply-entry_3')).toBeNull()
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(reply('entry_3')).toHaveFocus())
    await userEvent.keyboard('{ArrowDown}')
    await expect(reply('entry_3')).toHaveFocus()
    await userEvent.keyboard('{Home}')
    await waitFor(() => expect(reply('entry_401')).toHaveFocus())
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(reply('entry_3')).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expect(args.onSelect).toHaveBeenCalledWith('entry_3')
    await waitFor(() => expect(panel()).toBeNull())
  },
}

export const SpacePicksAReply: Story = {
  play: async ({ args }) => {
    await dialog()
    await userEvent.click(trigger())
    ;(await screen.findByTestId('close-chapter-reply-entry_69')).focus()
    await userEvent.keyboard(' ')
    await expect(args.onSelect).toHaveBeenCalledWith('entry_69')
    await waitFor(() => expect(panel()).toBeNull())
    await expect(trigger()).toHaveFocus()
  },
}

// Close chapter here hands its entry over as the pick.
export const EndEntryPicked: Story = {
  args: { initialSelectedId: 'entry_65' },
  play: async () => {
    await dialog()
    await expect(within(trigger()).getByText(formatEntryRef(65))).toBeVisible()
    expect(within(trigger()).queryByText(t('chapters:closeModal.latest'))).toBeNull()
    await expect(tokens()).toHaveTextContent('9,850 tokens in range')
  },
}

export const NoClosedChapter: Story = {
  args: { start: { ...START, id: 'entry_1', ref: formatEntryRef(1), endedChapterNumber: null } },
  play: async () => {
    await dialog()
    await expect(within(startRow()).getByText(formatEntryRef(1))).toBeVisible()
    expect(within(startRow()).queryByText(/ended here/)).toBeNull()
  },
}

// Nothing to close at: the reads are loading or failed, so there is no end entry to confirm.
export const NoSelection: Story = {
  args: { initialSelectedId: null },
  play: async ({ args }) => {
    await dialog()
    await expect(confirm()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTestId('close-chapter-picker')).toBeNull()
    await userEvent.click(confirm(), { pointerEventsCheck: 0 })
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

export const Disabled: Story = {
  args: { disabledReason: t('generationGate.inFlight') },
  play: async ({ args }) => {
    await dialog()
    await expect(confirm()).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByTitle(t('generationGate.inFlight'))).toContainElement(confirm())
    await userEvent.click(confirm(), { pointerEventsCheck: 0 })
    expect(args.onConfirm).not.toHaveBeenCalled()
  },
}

// Chromium blurs a button as it disables; focus must stay inside the dialog
// (lessons-learned/rnweb-disabled-under-focus-blurs.md).
export const FocusStaysWhenGateBlocks: Story = {
  render: (args) => <GatedHarness {...args} />,
  play: async () => {
    const shown = await dialog()
    confirm().focus()
    await expect(confirm()).toHaveFocus()
    window.dispatchEvent(new Event(GATE_EVENT))
    await waitFor(() => expect(confirm()).toHaveAttribute('aria-disabled', 'true'))
    await waitFor(() => expect(shown.contains(document.activeElement)).toBe(true))
    await userEvent.tab()
    expect(shown.contains(document.activeElement)).toBe(true)
  },
}

export const EscapeCancels: Story = {
  play: async ({ args }) => {
    await dialog()
    await userEvent.keyboard('{Escape}')
    await expect(args.onCancel).toHaveBeenCalledOnce()
  },
}

// A region with auto-close off has no upper bound, so the panel virtualizes.
export const LongRegionVirtualizes: Story = {
  args: { replies: manyReplies(200), latestId: 'entry_401', initialSelectedId: 'entry_401' },
  play: async () => {
    await dialog()
    await userEvent.click(trigger())
    const list = await screen.findByTestId('close-chapter-panel')
    await waitFor(() => expect(within(list).getAllByRole('option').length).toBeGreaterThan(0))
    expect(within(list).getAllByRole('option').length).toBeLessThan(200)
    expect(list.getBoundingClientRect().height).toBeLessThanOrEqual(PANEL_MAX + 1)
    list.scrollTop = list.scrollHeight
    await expect(await screen.findByTestId('close-chapter-reply-entry_3')).toBeVisible()
  },
}

// chapter-timeline.md → Mobile expression: a Modal at every tier, the panel in-flow under the
// trigger, and the foot on screen with the panel open.
export const Phone390: Story = {
  globals: { viewport: { value: 'phone390' } },
  args: PHONE_ARGS,
  play: async () => {
    const shown = await dialog()
    await waitFor(() =>
      expect(shown.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth),
    )
    await expectRowsLegible(PHONE_ARGS, 'two-line', PHONE_SNIPPET_MIN)
    await userEvent.click(trigger())
    const list = await screen.findByTestId('close-chapter-panel')
    expect(shown).toContainElement(list)
    expect(list.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      trigger().getBoundingClientRect().bottom,
    )
    expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      tokens().getBoundingClientRect().top,
    )
    expect(list.getBoundingClientRect().height).toBeLessThanOrEqual(PANEL_MAX + 1)
    await waitFor(() => expectReachable(confirm()))
  },
}

export const Phone360: Story = {
  globals: { viewport: { value: 'phone360' } },
  args: PHONE_ARGS,
  play: async () => {
    const shown = await dialog()
    await waitFor(() =>
      expect(shown.getBoundingClientRect().width).toBeLessThanOrEqual(window.innerWidth),
    )
    await expectRowsLegible(PHONE_ARGS, 'two-line', PHONE_SNIPPET_MIN)
  },
}

export const Phone360FourDigitRefs: Story = {
  globals: { viewport: { value: 'phone360' } },
  args: FOUR_DIGIT_ARGS,
  play: async () => {
    await expectRowsLegible(FOUR_DIGIT_ARGS, 'two-line', PHONE_SNIPPET_MIN)
    await expectLatestOptionWhole(FOUR_DIGIT_ARGS.replies[0]!)
  },
}

export const Phone320: Story = {
  globals: { viewport: { value: 'phone320' } },
  args: NARROWEST_ARGS,
  play: async () => {
    await expectRowsLegible(NARROWEST_ARGS, 'two-line', PHONE_SNIPPET_MIN_NARROWEST)
    await expectLatestOptionWhole(NARROWEST_ARGS.replies[0]!)
  },
}

// The narrowest tablet window: the dialog is still its 480 px cap, and the rows keep one line.
export const Tablet640: Story = {
  globals: { viewport: { value: 'tablet640' } },
  args: PHONE_ARGS,
  play: async () => {
    await expectRowsLegible(PHONE_ARGS, 'one-line', 60)
  },
}

// A short window: the panel gives up height so the foot stays on screen.
export const ShortWindow: Story = {
  globals: { viewport: { value: 'phoneShort' } },
  args: { replies: manyReplies(40), latestId: 'entry_81', initialSelectedId: 'entry_81' },
  play: async () => {
    const shown = await dialog()
    await userEvent.click(trigger())
    const list = await screen.findByTestId('close-chapter-panel')
    // RN-Web's window height can trail the viewport change by a frame, and the dialog cap with it.
    await waitFor(() =>
      expect(shown.getBoundingClientRect().height).toBeLessThanOrEqual(
        window.innerHeight * 0.9 + 1,
      ),
    )
    const height = list.getBoundingClientRect().height
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThan(PANEL_MAX - 40)
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
    await waitFor(() => expectReachable(confirm()))
  },
}
