import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useCallback, useState, useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { RowSaveBar } from '@/components/compounds/row-save-session-chrome'
import { externalCell } from '@/components/story-settings/external-cell'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ChapterSaveResult } from '@/lib/actions'
import type { ChapterDraft, ChapterDraftRow } from '@/lib/chapters'
import { t } from '@/lib/i18n'
import type { StoreChapter } from '@/lib/stores'

import { ChapterCard } from './chapter-card'
import type { ChapterCardData } from './chapter-timeline-data'
import { useChapterRowSession } from './use-chapter-row-session'

// CI runs plays several times slower than local; every post-interaction wait uses this.
const WAIT = { timeout: 5000 }
const PHONE = { viewport: { value: 'phone390' } }
const BLOCKED_REASON = t('generationGate.inFlight')
const TOGGLE_RUN = 'Toggle run'
const CLOSED_AT = Date.UTC(2026, 9, 14, 18, 30)
const NOOP = () => {}

const COPY = {
  jump: 'Jump to chapter →',
  regenerate: 'Regenerate summary',
  regenerateLater: 'Regenerating a summary lands in a later milestone',
  delete: 'Delete…',
  deleteLater: 'Deleting a chapter lands in a later milestone',
  review: 'Review changes',
  more: 'More chapter actions',
  title: 'Title',
  theme: 'Theme',
  summary: 'Summary',
  keywords: 'Keywords',
  titleRequired: "Title can't be empty",
  discard: 'Discard',
}

function chapter(
  overrides: Partial<StoreChapter> & Pick<StoreChapter, 'id' | 'sequenceNumber'>,
): StoreChapter {
  return {
    branchId: 'br_1',
    title: '',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: `entry_${overrides.sequenceNumber}_start`,
    endEntryId: `entry_${overrides.sequenceNumber}_end`,
    tokenCount: 0,
    closedAt: CLOSED_AT,
    embeddingStale: 0,
    createdAt: CLOSED_AT,
    updatedAt: CLOSED_AT,
    hasCloseReport: false,
    ...overrides,
  }
}

const TRAIL = chapter({
  id: 'chap_trail',
  sequenceNumber: 2,
  title: 'The Trail North',
  theme: 'travel, conflict',
  summary: 'Aria leaves the tavern with the courier and takes the north road.',
  keywords: ['north road', 'courier'],
  tokenCount: 12_400,
})
const TAVERN = chapter({
  id: 'chap_tavern',
  sequenceNumber: 1,
  title: 'The Tavern Encounter',
  summary: 'A stranger hands Aria a sealed letter.',
  tokenCount: 8_400,
})

const LATEST: ChapterCardData = {
  row: TRAIL,
  latest: true,
  timeLabel: 'Day 2 → Day 3',
  entryRange: { first: 12, last: 34 },
}
const EARLIER: ChapterCardData = {
  row: TAVERN,
  latest: false,
  timeLabel: null,
  entryRange: null,
}
const HEADING = 'Chapter 2 — The Trail North'
const EARLIER_HEADING = 'Chapter 1 — The Tavern Encounter'

type HarnessProps = {
  data: ChapterCardData
  initiallyExpanded: boolean
  onSave: (draft: ChapterDraft) => Promise<ChapterSaveResult>
  onJump: () => void
  /** The route's focus, forwarded to the in-card bar's Ctrl-S. */
  hotkeysEnabled: boolean
}

/** The route's wiring for one card: expansion keys the session, a save rewrites the row. */
function CardHarness({ data, initiallyExpanded, onSave, onJump, hotkeysEnabled }: HarnessProps) {
  const [cell] = useState(() => externalCell(data.row))
  const row = useSyncExternalStore(cell.subscribe, cell.get)
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [blocked, setBlocked] = useState(false)
  const save = useCallback(
    async (_row: ChapterDraftRow, draft: ChapterDraft): Promise<ChapterSaveResult> => {
      const result = await onSave(draft)
      if (result.status === 'ok') {
        cell.set({
          ...cell.get(),
          title: draft.title.trim(),
          theme: draft.theme.trim(),
          summary: draft.summary.trim(),
          keywords: draft.keywords,
        })
      }
      return result
    },
    [cell, onSave],
  )
  const session = useChapterRowSession({
    row: expanded ? row : null,
    onSave: save,
    onSaved: NOOP,
    onSession: NOOP,
  })
  const isPhone = useTier() === 'phone'
  return (
    <View className="gap-3">
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        onPress={() => setBlocked((prev) => !prev)}
      >
        <Text>{TOGGLE_RUN}</Text>
      </Button>
      <ChapterCard
        data={{ ...data, row }}
        onToggle={() => setExpanded((prev) => !prev)}
        session={expanded ? session : null}
        blockedReason={blocked ? BLOCKED_REASON : undefined}
        hotkeysEnabled={hotkeysEnabled}
        onJump={onJump}
      />
      {/* The route's phone bar: a sibling of the scroller, outside every card. */}
      {isPhone ? (
        <RowSaveBar session={session} blocked={blocked} blockedReason={BLOCKED_REASON} />
      ) : null}
    </View>
  )
}

const meta: Meta<typeof CardHarness> = {
  title: 'Compounds/Chapters/ChapterCard',
  component: CardHarness,
  parameters: {
    layout: 'padded',
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
    data: LATEST,
    initiallyExpanded: true,
    onSave: fn(async (): Promise<ChapterSaveResult> => ({ status: 'ok', id: TRAIL.id })),
    onJump: fn(),
    hotkeysEnabled: true,
  },
  decorators: [
    (Story) => (
      // The timeline column's cap: past FormRow's 640 px threshold at desktop, under it at 390 px,
      // so its guess and its measurement agree (lessons-learned/formrow-narrow-story-remount.md).
      <View style={{ width: 760, maxWidth: '100%' }}>
        <Story />
      </View>
    ),
  ],
}
export default meta
type Story = StoryObj<typeof CardHarness>

const findCard = (row: StoreChapter = TRAIL) =>
  screen.findByTestId(`chapter-card-${row.id}`, undefined, WAIT)

/** Desktop and tablet keep every action inline; only phone has the `⋯`. */
async function waitForInlineActions(card: HTMLElement) {
  await waitFor(
    () => expect(within(card).getByRole('button', { name: COPY.regenerate })).toBeVisible(),
    WAIT,
  )
  expect(within(card).queryByRole('button', { name: COPY.more })).toBeNull()
}

async function waitForPhoneActions(card: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => within(card).getByRole('button', { name: COPY.more }), WAIT)
}

/** The latest card: Jump live, Regenerate and Delete… disabled with their reasons, no review. */
export const Latest: Story = {
  play: async () => {
    const card = await findCard()
    await waitForInlineActions(card)

    expect(within(card).getByRole('button', { name: COPY.jump })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const regenerate = within(card).getByRole('button', { name: COPY.regenerate })
    expect(regenerate).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTitle(COPY.regenerateLater)).toContainElement(regenerate)
    const remove = within(card).getByRole('button', { name: COPY.delete })
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTitle(COPY.deleteLater)).toContainElement(remove)
    expect(within(card).queryByText(COPY.review)).toBeNull()

    expect(within(card).getByText('Day 2 → Day 3')).toBeVisible()
    expect(within(card).getByText('12,400 tok')).toBeVisible()
    expect(within(card).getByText('entries 12–34')).toBeVisible()
    expect(within(card).getByText(/^closed .*2026/)).toBeVisible()

    // Tablet and desktop: the bar sits inside the card.
    await userEvent.type(within(card).getByRole('textbox', { name: COPY.title }), ', revised')
    expect(await within(card).findByTestId('save-bar', undefined, WAIT)).toBeVisible()
  },
}

/** An earlier card has no Delete…, and no fact it has no data for. */
export const Earlier: Story = {
  args: { data: EARLIER },
  play: async () => {
    const card = await findCard(TAVERN)
    await waitForInlineActions(card)

    expect(within(card).getByRole('button', { name: COPY.jump })).toBeVisible()
    expect(within(card).queryByRole('button', { name: COPY.delete })).toBeNull()
    expect(within(card).queryByText(COPY.review)).toBeNull()
    expect(within(card).getByText('8,400 tok')).toBeVisible()
    expect(within(card).queryByText(/^entries /)).toBeNull()
  },
}

/**
 * The meta line joins only what a chapter has: no time label or theme drops its segment. It
 * describes the head, whose name stays the heading.
 */
export const Collapsed: Story = {
  render: () => (
    <View className="gap-3">
      <ChapterCard data={LATEST} onToggle={NOOP} session={null} hotkeysEnabled onJump={NOOP} />
      <ChapterCard data={EARLIER} onToggle={NOOP} session={null} hotkeysEnabled onJump={NOOP} />
    </View>
  ),
  play: async () => {
    const latest = await findCard(TRAIL)
    expect(within(latest).getByText('Day 2 → Day 3 · 12.4k tok · travel, conflict')).toBeVisible()

    const earlier = await findCard(TAVERN)
    expect(within(earlier).getByText('8.4k tok')).toBeVisible()
    expect(earlier).not.toHaveTextContent('·')

    for (const card of [latest, earlier]) {
      expect(within(card).queryByRole('textbox')).toBeNull()
      expect(within(card).queryByRole('button', { name: COPY.jump })).toBeNull()
    }

    const latestHead = within(latest).getByRole('button', { name: HEADING })
    expect(latestHead).toHaveAccessibleName(HEADING)
    expect(latestHead).toHaveAccessibleDescription('Day 2 → Day 3 · 12.4k tok · travel, conflict')
    const earlierHead = within(earlier).getByRole('button', { name: EARLIER_HEADING })
    expect(earlierHead).toHaveAccessibleName(EARLIER_HEADING)
    expect(earlierHead).toHaveAccessibleDescription('8.4k tok')
  },
}

/** The head toggles `aria-expanded`; opening loads the row into the fields. */
export const HeadToggles: Story = {
  args: { initiallyExpanded: false },
  play: async () => {
    const card = await findCard()
    const head = within(card).getByRole('button', { name: HEADING })
    expect(head).toHaveAttribute('aria-expanded', 'false')
    expect(within(card).queryByRole('textbox', { name: COPY.title })).toBeNull()

    await userEvent.click(head)
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'true'), WAIT)
    expect(await within(card).findByRole('textbox', { name: COPY.title }, WAIT)).toHaveValue(
      TRAIL.title,
    )

    await userEvent.click(head)
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'false'), WAIT)
    expect(within(card).queryByRole('textbox', { name: COPY.title })).toBeNull()
  },
}

/**
 * The one-pass lag after a switch, on every platform: the form still holds another chapter. Native
 * is where a field mounted in it would show that row.
 */
function LaggingFormHarness() {
  const session = useChapterRowSession({
    row: TAVERN,
    onSave: async () => ({ status: 'ok', id: TAVERN.id }),
    onSaved: NOOP,
    onSession: NOOP,
  })
  return (
    <ChapterCard data={LATEST} onToggle={NOOP} session={session} hotkeysEnabled onJump={NOOP} />
  )
}

/** An expanded card mounts no field while the form holds another row: none shows that row. */
export const FieldsWaitForTheirRow: Story = {
  render: () => <LaggingFormHarness />,
  play: async () => {
    const card = await findCard()
    expect(within(card).getByRole('button', { name: HEADING })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(within(card).queryAllByDisplayValue(TAVERN.title)).toEqual([])
    expect(within(card).queryAllByRole('textbox')).toEqual([])
  },
}

/** The in-card bar's Save writes the draft; the refreshed row closes the bar. */
export const SaveClosesTheBar: Story = {
  play: async ({ args }) => {
    const card = await findCard()
    await userEvent.type(within(card).getByRole('textbox', { name: COPY.title }), ', revised')
    const bar = await within(card).findByTestId('save-bar', undefined, WAIT)

    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(within(card).queryByTestId('save-bar')).toBeNull(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'The Trail North, revised' }),
    )
    expect(
      within(card).getByRole('button', { name: 'Chapter 2 — The Trail North, revised' }),
    ).toBeVisible()
  },
}

/** With the route focused, Ctrl-S in a field saves the card's draft. */
export const SaveShortcut: Story = {
  play: async ({ args }) => {
    const card = await findCard()
    await userEvent.type(within(card).getByRole('textbox', { name: COPY.title }), ', revised')
    await within(card).findByTestId('save-bar', undefined, WAIT)

    await userEvent.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(within(card).queryByTestId('save-bar')).toBeNull(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
    expect(args.onSave).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'The Trail North, revised' }),
    )
  },
}

/** Unfocused (another screen on top), Ctrl-S leaves the draft; the bar's Save still writes it. */
export const SaveShortcutUnfocused: Story = {
  args: { hotkeysEnabled: false },
  play: async ({ args }) => {
    const card = await findCard()
    await userEvent.type(within(card).getByRole('textbox', { name: COPY.title }), ', revised')
    const bar = await within(card).findByTestId('save-bar', undefined, WAIT)

    await userEvent.keyboard('{Control>}s{/Control}')
    expect(args.onSave).not.toHaveBeenCalled()
    // The bar's own Save proves the draft was still savable, so the key above had its chance.
    await userEvent.click(within(bar).getByRole('button', { name: /^Save/ }))
    await waitFor(() => expect(within(card).queryByTestId('save-bar')).toBeNull(), WAIT)
    expect(args.onSave).toHaveBeenCalledTimes(1)
  },
}

/** A cleared title disables Save with its reason; Discard stays live and restores it. */
export const InvalidDraft: Story = {
  play: async () => {
    const card = await findCard()
    const title = within(card).getByRole('textbox', { name: COPY.title })
    await userEvent.clear(title)
    const bar = await within(card).findByTestId('save-bar', undefined, WAIT)

    await waitFor(
      () => expect(within(bar).getByLabelText(COPY.titleRequired)).toBeInTheDocument(),
      WAIT,
    )
    const save = within(bar).getByRole('button', { name: /^Save/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save.closest('[title]')).toHaveAttribute('title', COPY.titleRequired)
    expect(within(card).getByText(COPY.titleRequired)).toBeVisible()

    const discard = within(bar).getByRole('button', { name: COPY.discard })
    expect(discard).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(discard)
    await waitFor(() => expect(within(card).queryByTestId('save-bar')).toBeNull(), WAIT)
    expect(title).toHaveValue(TRAIL.title)
  },
}

/** A run starts mid-edit: fields and Save disable with its reason; Discard, Jump, the head don't. */
export const Blocked: Story = {
  play: async ({ args }) => {
    const card = await findCard()
    const title = within(card).getByRole('textbox', { name: COPY.title })
    await userEvent.type(title, ', revised')
    const bar = await within(card).findByTestId('save-bar', undefined, WAIT)

    await userEvent.click(screen.getByRole('button', { name: TOGGLE_RUN }))
    await waitFor(
      () => expect(within(bar).getByLabelText(BLOCKED_REASON)).toBeInTheDocument(),
      WAIT,
    )

    for (const name of [COPY.title, COPY.theme, COPY.summary, COPY.keywords]) {
      expect(within(card).getByRole('textbox', { name })).toHaveAttribute('readonly')
    }
    const save = within(bar).getByRole('button', { name: /^Save/ })
    expect(save).toHaveAttribute('aria-disabled', 'true')
    expect(save.closest('[title]')).toHaveAttribute('title', BLOCKED_REASON)

    expect(within(card).getByRole('button', { name: HEADING })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    const jump = within(card).getByRole('button', { name: COPY.jump })
    expect(jump).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(jump)
    expect(args.onJump).toHaveBeenCalledTimes(1)

    const discard = within(bar).getByRole('button', { name: COPY.discard })
    expect(discard).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(discard)
    await waitFor(() => expect(within(card).queryByTestId('save-bar')).toBeNull(), WAIT)
    expect(within(card).getByRole('textbox', { name: COPY.title })).toHaveValue(TRAIL.title)
    expect(args.onSave).not.toHaveBeenCalled()

    // The run is still on: expand and collapse stay live.
    const head = within(card).getByRole('button', { name: HEADING })
    await userEvent.click(head)
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'false'), WAIT)
    await userEvent.click(head)
    await waitFor(() => expect(head).toHaveAttribute('aria-expanded', 'true'), WAIT)
  },
}

/** Phone: `Jump to chapter →` keeps its label; `⋯` lists the rest, disabled with their reasons. */
export const Phone390Actions: Story = {
  globals: PHONE,
  play: async () => {
    const card = await findCard()
    const more = await waitForPhoneActions(card)
    expect(within(card).getByRole('button', { name: COPY.jump })).toBeVisible()
    expect(within(card).queryByRole('button', { name: COPY.regenerate })).toBeNull()
    expect(within(card).queryByRole('button', { name: COPY.delete })).toBeNull()

    await userEvent.click(more)
    // The bottom Sheet presents a tick past the click.
    const regenerate = await waitFor(
      () => screen.getByRole('menuitem', { name: `${COPY.regenerate}, ${COPY.regenerateLater}` }),
      WAIT,
    )
    await waitFor(() => expect(regenerate).toBeVisible(), WAIT)
    expect(regenerate).toHaveAttribute('aria-disabled', 'true')
    const remove = screen.getByRole('menuitem', { name: `${COPY.delete}, ${COPY.deleteLater}` })
    expect(remove).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('menuitem', { name: /^Review changes/ })).toBeNull()
  },
}

/** Phone: the card holds no bar; the surface's own bar (the harness's) shows the edit. */
export const Phone390SaveBar: Story = {
  globals: PHONE,
  play: async () => {
    const card = await findCard()
    await waitForPhoneActions(card)

    await userEvent.type(within(card).getByRole('textbox', { name: COPY.title }), ', revised')
    expect(await screen.findByTestId('save-bar', undefined, WAIT)).toBeVisible()
    expect(within(card).queryByTestId('save-bar')).toBeNull()
  },
}
