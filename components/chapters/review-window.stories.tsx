import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useWindowDimensions, View } from 'react-native'
import { expect, fn, screen, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { formatEntryRef } from '@/lib/entry-refs'
import type { CloseReview, CloseReviewChange, CloseReviewNotApplied } from '@/lib/history'
import { t } from '@/lib/i18n'

import { ReviewWindow, type ReviewWindowState } from './review-window'

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 5000 }
const PHONE = { viewport: { value: 'phone390' } }
const TITLE = 'Review — Chapter 2: The Trail North'
const ENTRY_POSITIONS = new Map([
  ['entry_31', 31],
  ['entry_47', 47],
])

const TITHE: CloseReviewChange = {
  key: '0:lore_tithe',
  op: 'create',
  area: 'lore',
  target: { table: 'lore', id: 'lore_tithe', name: 'The Tithe of Hours' },
  fieldPath: null,
  fieldLabel: null,
  summary: 'Every adult owes the temple one hour a year.',
  why: 'Sael explains the tithe.',
  entryId: 'entry_31',
  pressTo: { table: 'lore', id: 'lore_tithe' },
}

const KAEL_VOICE: CloseReviewChange = {
  key: '3:char_kael:state.voice',
  op: 'update',
  area: 'charactersAndFactions',
  target: { table: 'entities', id: 'char_kael', name: 'Kael' },
  fieldPath: 'state.voice',
  fieldLabel: 'Voice',
  summary: 'wry, joking → short, flat sentences',
  why: 'He stops joking after Oss.',
  entryId: 'entry_47',
  pressTo: { table: 'entities', id: 'char_kael' },
}

const FERRY: CloseReviewNotApplied = {
  key: '1:lore_ferry',
  op: 'create',
  tool: 'create_lore',
  target: { table: 'lore', id: 'lore_ferry', name: "The Ferryman's Due" },
  fieldPath: null,
  fieldLabel: null,
  summary: 'A coin at every river crossing, paid to the ferrymen.',
  reasonKey: 'lore-cap',
  reasonText: 'Over the lore cap.',
  pressTo: null,
}

const ARIA_VOICE: CloseReviewNotApplied = {
  key: '4:char_aria:state.voice',
  op: 'update',
  tool: 'update_character',
  target: { table: 'entities', id: 'char_aria', name: 'Aria' },
  fieldPath: 'state.voice',
  fieldLabel: 'Voice',
  summary: 'measured, guarded',
  reasonKey: 'user-edited-since-prose',
  reasonText: 'You changed this field after the cited entry.',
  pressTo: { table: 'entities', id: 'char_aria' },
}

const TOLFDEN: CloseReviewNotApplied = {
  key: '6:loc_tolfden:description',
  op: 'update',
  tool: 'update_place',
  target: { table: 'entities', id: 'loc_tolfden', name: 'Tolfden' },
  fieldPath: 'description',
  fieldLabel: 'Description',
  summary: "Ridge town under the warden's banners.",
  reasonKey: 'later-turn',
  reasonText: 'A later turn wrote this field.',
  pressTo: { table: 'entities', id: 'loc_tolfden' },
}

// A refusal that recorded no row: its tool names it.
const NO_KEEP: CloseReviewNotApplied = {
  key: '7',
  op: 'update',
  tool: 'merge_threads',
  target: null,
  fieldPath: null,
  fieldLabel: null,
  summary: '',
  reasonKey: 'merge-no-keep',
  reasonText: 'The merge named no thread to keep.',
  pressTo: null,
}

const FULL: CloseReview = {
  stopped: [
    {
      task: 'identity',
      part: 2,
      reason: 'budget',
      text: 'Identity, part 2 — reached its step limit',
    },
  ],
  noToolCalls: false,
  notApplied: [FERRY, ARIA_VOICE, TOLFDEN, NO_KEEP],
  changes: [
    { area: 'lore', rows: [TITHE] },
    { area: 'charactersAndFactions', rows: [KAEL_VOICE] },
  ],
}

const FILLER: CloseReviewChange[] = Array.from({ length: 14 }, (_, i) => ({
  key: `filler-${i}`,
  op: 'update',
  area: 'threads',
  target: { table: 'threads', id: `thread_${i}`, name: `Thread ${i + 1}` },
  fieldPath: 'description',
  fieldLabel: 'Description',
  summary: 'An old lead → a lead the chapter picked up again',
  why: 'The chapter returns to it.',
  entryId: 'entry_47',
  pressTo: { table: 'threads', id: `thread_${i}` },
}))

const LONG_LIST: CloseReview = {
  ...FULL,
  changes: [...FULL.changes, { area: 'threads', rows: FILLER }],
}

const LONG_SUMMARY =
  'A ridge town of slate roofs and narrow stairs, its gate kept by two wardens who trade watches at the bell; the market fills at dawn with traders from the river road → a ridge town under the warden’s banners, its gate shut at dusk since the fire, its market moved inside the walls and its stairs patrolled by the warden’s own men, who turn back anyone without a token from the keep'

const LONG_VALUE: CloseReview = {
  stopped: [],
  noToolCalls: false,
  notApplied: [],
  changes: [
    {
      area: 'placesAndItems',
      rows: [
        {
          ...KAEL_VOICE,
          key: '2:loc_tolfden:description',
          area: 'placesAndItems',
          target: { table: 'entities', id: 'loc_tolfden', name: 'Tolfden' },
          fieldPath: 'description',
          fieldLabel: 'Description',
          summary: LONG_SUMMARY,
          pressTo: { table: 'entities', id: 'loc_tolfden' },
        },
      ],
    },
  ],
}

const NOTHING: CloseReview = { stopped: [], noToolCalls: false, notApplied: [], changes: [] }

type HarnessProps = {
  status: ReviewWindowState['status']
  review: CloseReview
  onOpenChange: (open: boolean) => void
  onRetry: () => void
  onRowPress: (key: string) => void
  onEntryLink: (key: string) => void
  /** Keys of rows whose target the host found gone. */
  unpressable: readonly string[]
}

function stateOf(
  status: ReviewWindowState['status'],
  review: CloseReview,
  onRetry: () => void,
): ReviewWindowState {
  if (status === 'loading') return { status }
  if (status === 'failed') return { status, onRetry }
  return { status, review }
}

/** The host's wiring, with presses recorded by row key. */
function ReviewWindowHarness({
  status,
  review,
  onOpenChange,
  onRetry,
  onRowPress,
  onEntryLink,
  unpressable,
}: HarnessProps) {
  const { height } = useWindowDimensions()
  // gorhom's container fills its parent, so a detent is a share of this stage's height.
  return (
    <View style={{ height }}>
      <ReviewWindow
        open
        onOpenChange={onOpenChange}
        title={TITLE}
        state={stateOf(status, review, onRetry)}
        pressOf={(row) =>
          row.pressTo == null || unpressable.includes(row.key)
            ? undefined
            : () => onRowPress(row.key)
        }
        entryLinkOf={(row) => {
          const position = row.entryId == null ? undefined : ENTRY_POSITIONS.get(row.entryId)
          if (position == null) return undefined
          return {
            label: t('chapters:review.entryLink', { entry: formatEntryRef(position) }),
            onPress: () => onEntryLink(row.key),
          }
        }}
      />
    </View>
  )
}

const meta: Meta<typeof ReviewWindowHarness> = {
  title: 'Compounds/Chapters/ReviewWindow',
  component: ReviewWindowHarness,
  parameters: {
    layout: 'fullscreen',
    // No built-in key is 390 px wide, and an unknown key falls back to desktop.
    viewport: {
      options: {
        phone390: {
          name: 'Phone 390',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
      },
    },
  },
  args: {
    status: 'ready',
    review: FULL,
    onOpenChange: fn(),
    onRetry: fn(),
    onRowPress: fn(),
    onEntryLink: fn(),
    unpressable: [],
  },
}
export default meta
type Story = StoryObj<typeof ReviewWindowHarness>

// The window fades in; a toBeVisible read during the fade sees opacity 0.
async function findWindow(): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name: TITLE }, WAIT)
  await waitFor(() => expect(dialog).toBeVisible(), WAIT)
  return dialog
}

const twoFrames = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )

// gorhom animates the Sheet in on web; a top read mid-slide would move under the assertion.
async function settledTop(el: HTMLElement): Promise<number> {
  let settled = Number.NaN
  await waitFor(async () => {
    const before = el.getBoundingClientRect().top
    await new Promise((resolve) => setTimeout(resolve, 120))
    settled = el.getBoundingClientRect().top
    expect(settled).toBe(before)
  }, WAIT)
  return settled
}

/** The list scrolls between a head and a foot that stay put. */
async function expectPinnedChrome(
  dialog: HTMLElement,
  head: HTMLElement,
  done: HTMLElement,
): Promise<void> {
  const list = within(dialog).getByTestId('review-window-list')
  await waitFor(() => expect(list.scrollHeight).toBeGreaterThan(list.clientHeight), WAIT)
  const headTop = await settledTop(head)
  const doneTop = await settledTop(done)
  list.scrollTop = list.scrollHeight
  await twoFrames()
  expect(list.scrollTop).toBeGreaterThan(0)
  expect(Math.abs(head.getBoundingClientRect().top - headTop)).toBeLessThanOrEqual(1)
  expect(Math.abs(done.getBoundingClientRect().top - doneTop)).toBeLessThanOrEqual(1)
  expect(done.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight + 1)
}

function expectInOrder(elements: readonly HTMLElement[]) {
  for (let i = 1; i < elements.length; i += 1) {
    expect(
      elements[i - 1].compareDocumentPosition(elements[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  }
}

/** Desktop: a Dialog with ×; Stopped early, then Not applied (collapsed), then areas in order. */
export const Full: Story = {
  play: async ({ args }) => {
    const dialog = await findWindow()
    expect(within(dialog).getByRole('heading', { name: TITLE, level: 2 })).toBeVisible()
    const stopped = within(dialog).getByRole('heading', { name: 'Stopped early', level: 3 })
    expect(within(dialog).getByText('Identity, part 2 — reached its step limit')).toBeVisible()
    const notApplied = within(dialog).getByRole('button', { name: 'Not applied (4)' })
    expect(notApplied).toHaveAttribute('aria-expanded', 'false')
    expect(within(dialog).queryByText('Over the lore cap.')).toBeNull()
    expectInOrder([
      stopped,
      notApplied,
      within(dialog).getByRole('heading', { name: 'Lore', level: 3 }),
      within(dialog).getByRole('heading', { name: 'Characters and factions', level: 3 }),
    ])

    // A row shows old → new, its why and its entry link; the meta line is off.
    expect(within(dialog).getByText('wry, joking → short, flat sentences')).toBeVisible()
    expect(within(dialog).getByText('He stops joking after Oss.')).toBeVisible()
    expect(within(dialog).getByRole('link', { name: 'entry #47 →' })).toBeVisible()
    expect(within(dialog).queryByText(/chapter close/)).toBeNull()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenNthCalledWith(1, false), WAIT)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(args.onOpenChange).toHaveBeenNthCalledWith(2, false), WAIT)
  },
}

/** Not applied opens to each refused write: its value and reason, pressable when its row is live. */
export const NotAppliedOpens: Story = {
  play: async () => {
    const warn = spyOn(console, 'warn')
    const dialog = await findWindow()
    const trigger = within(dialog).getByRole('button', { name: 'Not applied (4)' })
    await userEvent.click(trigger)
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'true'), WAIT)

    expect(await within(dialog).findByText('Over the lore cap.', {}, WAIT)).toBeVisible()
    expect(within(dialog).getByText('measured, guarded')).toBeVisible()
    expect(within(dialog).getByText('You changed this field after the cited entry.')).toBeVisible()
    expect(within(dialog).getByText('A later turn wrote this field.')).toBeVisible()
    expect(within(dialog).getByText('Thread merge')).toBeVisible()
    expect(within(dialog).queryByText('merge_threads')).toBeNull()
    expect(within(dialog).getByRole('button', { name: 'update Aria' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'update Tolfden' })).toBeVisible()
    // A refused create has no row to open.
    expect(within(dialog).queryByRole('button', { name: /^create The Ferryman/ })).toBeNull()
    // Only Changes rows carry an entry link.
    expect(
      within(dialog)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['entry #31 →', 'entry #47 →'])
    // The Accordion needs a defaultValue, or its first expand flips it to controlled.
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/uncontrolled to controlled/))
    warn.mockRestore()
  },
}

/** A row's press is the host's: a Changes row and a Not applied row each fire their own. */
export const RowPress: Story = {
  play: async ({ args }) => {
    const dialog = await findWindow()
    await userEvent.click(within(dialog).getByRole('button', { name: 'update Kael' }))
    await waitFor(() => expect(args.onRowPress).toHaveBeenCalledWith(KAEL_VOICE.key), WAIT)

    await userEvent.click(within(dialog).getByRole('button', { name: 'Not applied (4)' }))
    await userEvent.click(await within(dialog).findByRole('button', { name: 'update Aria' }, WAIT))
    await waitFor(() => expect(args.onRowPress).toHaveBeenCalledWith(ARIA_VOICE.key), WAIT)
    expect(args.onRowPress).toHaveBeenCalledTimes(2)
    expect(args.onEntryLink).not.toHaveBeenCalled()
  },
}

/** The entry link sits outside the row's button: its press fires the link's alone. */
export const EntryLinkPress: Story = {
  play: async ({ args }) => {
    const dialog = await findWindow()
    await userEvent.click(within(dialog).getByRole('link', { name: 'entry #47 →' }))
    await waitFor(() => expect(args.onEntryLink).toHaveBeenCalledWith(KAEL_VOICE.key), WAIT)
    expect(args.onEntryLink).toHaveBeenCalledTimes(1)
    expect(args.onRowPress).not.toHaveBeenCalled()
  },
}

/** RN-Web presses a role=link element on click only; Enter on the focused link must press it. */
export const EntryLinkEnter: Story = {
  play: async ({ args }) => {
    const dialog = await findWindow()
    const link = within(dialog).getByRole('link', { name: 'entry #47 →' })
    link.focus()
    await waitFor(() => expect(link).toHaveFocus(), WAIT)
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(args.onEntryLink).toHaveBeenCalledWith(KAEL_VOICE.key), WAIT)
    expect(args.onEntryLink).toHaveBeenCalledTimes(1)
    expect(args.onRowPress).not.toHaveBeenCalled()
  },
}

/** A target the host found gone doesn't press; its entry link still does. */
export const UnpressableRow: Story = {
  args: { unpressable: [KAEL_VOICE.key] },
  play: async ({ args }) => {
    const dialog = await findWindow()
    expect(within(dialog).queryByRole('button', { name: 'update Kael' })).toBeNull()
    expect(within(dialog).getByText('Kael')).toBeVisible()
    await userEvent.click(within(dialog).getByRole('link', { name: 'entry #47 →' }))
    await waitFor(() => expect(args.onEntryLink).toHaveBeenCalledWith(KAEL_VOICE.key), WAIT)
    expect(args.onRowPress).not.toHaveBeenCalled()
  },
}

/** `summaryLines={null}`: a two-line clamp would hide the new half of old → new. */
export const LongValue: Story = {
  args: { review: LONG_VALUE },
  play: async () => {
    const dialog = await findWindow()
    const summary = within(dialog).getByText(LONG_SUMMARY)
    expect(getComputedStyle(summary).webkitLineClamp).toBe('none')
    expect(summary.scrollHeight).toBeLessThanOrEqual(summary.clientHeight + 1)
  },
}

/** A refusal with no row names what its tool writes; a tool this list doesn't know reads as unknown. */
export const NoRowRefusals: Story = {
  args: {
    review: {
      ...NOTHING,
      notApplied: [
        { ...NO_KEEP, key: '7', tool: 'update_character' },
        { ...NO_KEEP, key: '8', tool: 'future_write_tool' },
      ],
    },
  },
  play: async () => {
    const dialog = await findWindow()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not applied (2)' }))
    expect(await within(dialog).findByText('Character', {}, WAIT)).toBeVisible()
    expect(within(dialog).getByText('Unknown row')).toBeVisible()
    expect(within(dialog).queryByText(/update_character|future_write_tool/)).toBeNull()
  },
}

/** No task called a tool: the note shows, with no Stopped early heading and no empty line. */
export const NoToolCalls: Story = {
  args: { review: { ...NOTHING, noToolCalls: true } },
  play: async () => {
    const dialog = await findWindow()
    // Task 4 owns this copy; the play pins that the note renders, not its wording.
    expect(within(dialog).getByText(t('chapters:review.noToolCalls'))).toBeVisible()
    expect(within(dialog).queryByRole('heading', { name: 'Stopped early', level: 3 })).toBeNull()
    expect(within(dialog).queryByText('This close changed nothing.')).toBeNull()
  },
}

/** A report with nothing to show reads as empty, with no section at all. */
export const Empty: Story = {
  args: { review: NOTHING },
  play: async () => {
    const dialog = await findWindow()
    expect(within(dialog).getByText('This close changed nothing.')).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: /^Not applied/ })).toBeNull()
    expect(within(dialog).queryByRole('heading', { name: 'Stopped early', level: 3 })).toBeNull()
  },
}

export const Loading: Story = {
  args: { status: 'loading' },
  play: async () => {
    const dialog = await findWindow()
    expect(within(dialog).getByText("Reading the close's changes…")).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: /^Not applied/ })).toBeNull()
  },
}

export const Failed: Story = {
  args: { status: 'failed' },
  play: async ({ args }) => {
    const dialog = await findWindow()
    expect(within(dialog).getByText("The close's changes couldn't be read.")).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(args.onRetry).toHaveBeenCalledTimes(1), WAIT)
  },
}

/** Desktop: a long report scrolls inside the Dialog, its head and Done in place. */
export const LongList: Story = {
  args: { review: LONG_LIST },
  play: async ({ args }) => {
    const dialog = await findWindow()
    const heading = within(dialog).getByRole('heading', { name: TITLE, level: 2 })
    const done = within(dialog).getByRole('button', { name: 'Done' })
    await expectPinnedChrome(dialog, heading, done)

    await userEvent.click(done)
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false), WAIT)
  },
}

/** Phone: a tall Sheet, no ×, its list scrolling between the pinned head and Done. */
export const Phone390Sheet: Story = {
  globals: PHONE,
  args: { review: LONG_LIST },
  play: async ({ args }) => {
    const dialog = await findWindow()
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull()
    const heading = within(dialog).getByRole('heading', { name: TITLE, level: 2 })
    const done = within(dialog).getByRole('button', { name: 'Done' })
    // touch.md → Touch-target floor.
    for (const link of within(dialog).getAllByRole('link')) {
      expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44)
    }

    // A tall detent puts the head near the window's top; a short or medium one sits far lower.
    expect(await settledTop(heading)).toBeLessThan(window.innerHeight * 0.2)
    await expectPinnedChrome(dialog, heading, done)

    await userEvent.click(done)
    await waitFor(() => expect(args.onOpenChange).toHaveBeenCalledWith(false), WAIT)
  },
}
