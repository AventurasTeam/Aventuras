import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState, type ComponentProps } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { StoryEntry, SystemFailureMeta } from '@/lib/db'
import { t } from '@/lib/i18n'

import { ReaderSurface } from './reader-surface'
import {
  describePassFailure,
  describeTurnFailure,
  passResolvedEntry,
  toPassFailureMeta,
} from './system-entry-actions'

const NOW = 1752900000000

const BASE_META = { sceneEntities: [], currentLocationId: null, worldTime: NOW }

// Module scope keeps the frame referentially stable — the edit form's tuple
// memo keys on its identity.
const WORLD_TIME_ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

function entry(
  partial: Partial<StoryEntry> & Pick<StoryEntry, 'id' | 'kind' | 'content' | 'position'>,
): StoryEntry {
  return {
    branchId: 'branch_story',
    chapterId: null,
    metadata: null,
    createdAt: NOW,
    ...partial,
  }
}

const RICH_HTML = [
  '<style>.gal{display:grid;grid-template-columns:1fr 1fr;gap:8px}.gal div{padding:12px;background:linear-gradient(135deg,#1c2541,#3a506b);color:#fff;border-radius:6px}</style>',
  '<div class="gal"><div>East wing</div><div>West wing</div></div>',
].join('\n')

const ROWS: StoryEntry[] = [
  entry({
    id: 'e1',
    kind: 'opening',
    content: 'The gallery had no doors, and yet every visitor arrived.',
    position: 1,
  }),
  entry({
    id: 'e2',
    kind: 'user_action',
    content: 'I step through the frame of the first painting.',
    position: 2,
  }),
  entry({
    id: 'e3',
    kind: 'ai_reply',
    content:
      'Paint parts around you like water. *The room beyond is impossible* — wider than the building itself.',
    position: 3,
    metadata: {
      ...BASE_META,
      reasoning: 'The visitor tests the gallery rules; escalate spatial impossibility.',
    },
  }),
  entry({ id: 'e4', kind: 'ai_reply', content: RICH_HTML, position: 4 }),
  entry({
    id: 'e5',
    kind: 'user_action',
    content: 'I map the two wings against each other.',
    position: 5,
  }),
]

const sceneWiring = {
  entityNames: [],
  sceneOptions: { characters: [], items: [], locations: [] },
  tailEntryId: null,
}

const noopHandlers = {
  onEditScene: async () => ({ ok: true }),
  onRequestEditScene: () => {},
  onNearTop: async () => {},
  onCommitEdit: async () => ({ ok: true }),
  onRequestRollback: async () => {},
  onEditWorldTime: async () => ({ ok: true }),
  onRequestEditWorldTime: async () => {},
  onRegenerate: async () => {},
  onRetrySystemEntry: async () => {},
  onDismissSystemEntry: async () => {},
  onFixSystemEntry: async () => {},
}

const HEAD_TURN_ROWS = ROWS.slice(0, 3)
const EDITED_ACTION = 'I step through the frame of the second painting.'

const PASS_ROWS: StoryEntry[] = [
  entry({
    id: 'p1',
    kind: 'opening',
    content: 'The gallery had no doors, and yet every visitor arrived.',
    position: 1,
  }),
  entry({
    id: 'p2',
    kind: 'user_action',
    content: 'I step through the frame of the first painting.',
    position: 2,
  }),
  entry({ id: 'p3', kind: 'ai_reply', content: 'Paint parts around you like water.', position: 3 }),
  entry({
    id: 'p4',
    kind: 'user_action',
    content: 'I map the two wings against each other.',
    position: 4,
  }),
  entry({
    id: 'p5',
    kind: 'ai_reply',
    content: 'The wings refuse to line up.',
    position: 5,
    metadata: BASE_META,
  }),
]

// Tail's time and scene editors would be live ungated: their absence is the gate's doing.
const PASS_IN_FLIGHT_ARGS = {
  rows: PASS_ROWS,
  tailEntryId: 'p5',
  worldTimeDecorations: { p5: { label: 'Day 12 · 14:33', raw: 90 } },
  worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: WORLD_TIME_ORIGIN },
}

function rowButton(id: string, name: string): HTMLElement {
  return within(entryRow(id)).getByRole('button', { name })
}

function entryRow(id: string): HTMLElement {
  const row = document.querySelector(`[data-entry-row="${id}"]`)
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${id}`)
  return row
}

async function startEditingHeadAction() {
  await userEvent.click(
    within(entryRow('e2')).getByRole('button', { name: t('reader:entryCard.editEntry') }),
  )
  const textarea = await waitFor(() =>
    screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
  )
  await userEvent.clear(textarea)
  await userEvent.type(textarea, EDITED_ACTION)
  await waitFor(() => expect(textarea).toHaveValue(EDITED_ACTION))
}

const meta = {
  title: 'Compounds/Reader/ReaderSurface',
  component: ReaderSurface,
  decorators: [
    (Story) => (
      <div style={{ height: 480, border: '1px solid #ccc' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    rows: ROWS,
    // Footer behavior is covered at the compound layer (entry-card.stories);
    // these stories exercise the surface's scroll/edit machinery instead.
    worldTimeDecorations: {},
    worldTimeFrame: null,
    streaming: null,
    branchKey: 'branch_story',
    hasOlder: false,
    editGate: 'open',
    jumpButtonEnabled: true,
    ...noopHandlers,
    ...sceneWiring,
  },
} satisfies Meta<typeof ReaderSurface>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/**
 * The adapter between the host's `EditResult` and EntryCard's boolean is the one
 * link the compound-layer stories cannot reach: dropping the `.ok` unwrap here
 * returns `undefined`, which would close the Dialog on a write that failed and
 * discard the typed tuple. Driven through the surface for exactly that reason.
 */
export const WorldTimeEditFailureKeepsOverlayOpen: Story = {
  args: {
    worldTimeDecorations: { e3: { label: 'Day 12 · 14:33', raw: 90 } },
    worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: WORLD_TIME_ORIGIN },
    onEditWorldTime: fn(async () => ({ ok: false })),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditWorldTime).toHaveBeenCalledWith('e3', 105))

    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
  },
}

/**
 * The surface resolves the tier for the whole list, so this is the only layer where the
 * viewport → `useTier` → request-fork wiring is still exercised end to end; the compound
 * now takes the resolved value as a prop and states it outright.
 */
export const PhoneRequestsHostOverlay: Story = {
  globals: { viewport: { value: 'mobile1' } },
  args: {
    worldTimeDecorations: { e3: { label: 'Day 12 · 14:33', raw: 90 } },
    worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: WORLD_TIME_ORIGIN },
    onRequestEditWorldTime: fn(async () => {}),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(args.onRequestEditWorldTime).toHaveBeenCalledWith('e3'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/**
 * `Save & regenerate` is a compose seam the compound layer cannot reach: the
 * commit must land before the run starts, because the pipeline re-reads its
 * prompt from the branch tail rather than from anything threaded in.
 */
export const SaveAndRegenerateHeadTurn: Story = {
  args: {
    rows: HEAD_TURN_ROWS,
    tailEntryId: 'e3',
    onCommitEdit: fn(async () => ({ ok: true })),
    onRegenerate: fn(async () => {}),
  },
  play: async ({ args }) => {
    const order: string[] = []
    ;(args.onCommitEdit as ReturnType<typeof fn>).mockImplementation(async () => {
      order.push('commit')
      return { ok: true }
    })
    ;(args.onRegenerate as ReturnType<typeof fn>).mockImplementation(async () => {
      order.push('regenerate')
    })

    await startEditingHeadAction()
    await userEvent.click(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    )

    await waitFor(() => expect(args.onRegenerate).toHaveBeenCalledWith('e3'))
    expect(args.onCommitEdit).toHaveBeenCalledWith('e2', EDITED_ACTION)
    expect(order).toEqual(['commit', 'regenerate'])
  },
}

/** A refused write must not spend a generation on prose the branch never took. */
export const SaveAndRegenerateHeldByFailedWrite: Story = {
  args: {
    rows: HEAD_TURN_ROWS,
    tailEntryId: 'e3',
    onCommitEdit: fn(async () => ({ ok: false })),
    onRegenerate: fn(async () => {}),
  },
  play: async ({ args }) => {
    await startEditingHeadAction()
    await userEvent.click(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    )

    await waitFor(() => expect(args.onCommitEdit).toHaveBeenCalledWith('e2', EDITED_ACTION))
    expect(args.onRegenerate).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: t('reader:entryCard.editContent') })).toHaveValue(
      EDITED_ACTION,
    )
  },
}

/** A pristine editor spends nothing: Save-and-regenerate would still cost a generation. */
export const EditorPristineGatesBothCommits: Story = {
  args: {
    rows: HEAD_TURN_ROWS,
    tailEntryId: 'e3',
    onCommitEdit: fn(async () => ({ ok: true })),
    onRegenerate: fn(async () => {}),
  },
  play: async ({ args }) => {
    await userEvent.click(
      within(entryRow('e2')).getByRole('button', { name: t('reader:entryCard.editEntry') }),
    )
    await waitFor(() => screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }))

    expect(screen.getByRole('button', { name: t('save') })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: t('cancel') })).not.toBeDisabled()

    // Typing the draft away from the stored prose is what releases them.
    await userEvent.type(
      screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
      '!',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: t('save') })).not.toBeDisabled())
    // Both, not just Save: the gate is what this story is about, so it asserts the
    // release directly rather than leaning on the sibling stories that click through it.
    expect(
      screen.getByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    ).not.toBeDisabled()
    expect(args.onCommitEdit).not.toHaveBeenCalled()
    expect(args.onRegenerate).not.toHaveBeenCalled()
  },
}

/** Only the head turn's action gets the third button; every other row keeps Save / Cancel. */
export const SaveAndRegenerateAbsentOffHead: Story = {
  args: { rows: HEAD_TURN_ROWS, tailEntryId: 'e3' },
  play: async () => {
    await userEvent.click(
      within(entryRow('e1')).getByRole('button', { name: t('reader:entryCard.editEntry') }),
    )
    await waitFor(() =>
      expect(
        screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
      ).toBeVisible(),
    )
    expect(
      screen.queryByRole('button', { name: t('reader:entryCard.saveAndRegenerate') }),
    ).not.toBeInTheDocument()
  },
}

/**
 * Head reversals interrupt a pass: every ↻ and ×, and the head turn's pencils, stay live;
 * the rest keeps the gate (principles.md → Edit restrictions during in-flight generation).
 */
export const PassInFlightHeadTurnLive: Story = {
  args: { ...PASS_IN_FLIGHT_ARGS, editGate: 'interruptible' },
  play: async () => {
    const edit = t('reader:entryCard.editEntry')
    await waitFor(() => expect(rowButton('p5', edit)).not.toBeDisabled())
    expect(rowButton('p4', edit)).not.toBeDisabled()
    for (const id of ['p1', 'p2', 'p3']) expect(rowButton(id, edit)).toBeDisabled()
    for (const id of ['p3', 'p5'])
      expect(rowButton(id, t('reader:entryCard.regenerate'))).not.toBeDisabled()
    for (const id of ['p2', 'p3', 'p4', 'p5'])
      expect(rowButton(id, t('reader:entryCard.deleteEntry'))).not.toBeDisabled()
    expect(
      screen.queryByRole('button', { name: t('reader:worldTimeEdit.title') }),
    ).not.toBeInTheDocument()

    await userEvent.click(rowButton('p5', t('reader:entryCard.showState')))
    expect(
      within(entryRow('p5')).queryByRole('button', { name: t('reader:entryCard.stateEditScene') }),
    ).not.toBeInTheDocument()
  },
}

/** A closed gate holds every row control, the head turn's included. */
export const ClosedGateHoldsEveryRow: Story = {
  args: { ...PASS_IN_FLIGHT_ARGS, editGate: 'closed' },
  play: async () => {
    await waitFor(() => expect(rowButton('p5', t('reader:entryCard.editEntry'))).toBeDisabled())
    expect(rowButton('p5', t('reader:entryCard.regenerate'))).toBeDisabled()
    expect(rowButton('p5', t('reader:entryCard.deleteEntry'))).toBeDisabled()
    expect(rowButton('p4', t('reader:entryCard.editEntry'))).toBeDisabled()
  },
}

/** A gated row control is named and titled by the gate's reason; a live one keeps its own name. */
export const GatedRowControlNamesTheRun: Story = {
  args: {
    ...PASS_IN_FLIGHT_ARGS,
    editGate: 'interruptible',
    gateReason: t('generationGate.updatingMemory'),
  },
  play: async () => {
    const reason = t('generationGate.updatingMemory')
    const pencil = await waitFor(() => within(entryRow('p3')).getByRole('button', { name: reason }))
    expect(pencil).toBeDisabled()
    expect(pencil.closest('[title]')?.getAttribute('title')).toBe(reason)
    expect(rowButton('p3', t('reader:entryCard.regenerate'))).not.toBeDisabled()
    expect(rowButton('p5', t('reader:entryCard.editEntry'))).not.toBeDisabled()
    expect(within(entryRow('p5')).queryByRole('button', { name: reason })).not.toBeInTheDocument()
  },
}

/** A closed gate names the head reversals' blocker on the head turn's controls too. */
export const ClosedGateNamesItsBlocker: Story = {
  args: {
    ...PASS_IN_FLIGHT_ARGS,
    editGate: 'closed',
    gateReason: t('generationGate.suggestionRefresh'),
  },
  play: async () => {
    const reason = t('generationGate.suggestionRefresh')
    const gated = await waitFor(() => {
      const buttons = within(entryRow('p5')).getAllByRole('button', { name: reason })
      expect(buttons).toHaveLength(3)
      return buttons
    })
    for (const button of gated) expect(button).toBeDisabled()
  },
}

// Enough rows to overflow the 480 px box, so the viewport can shrink under a reader at the bottom.
const OVERFLOW_ROWS: StoryEntry[] = Array.from({ length: 14 }, (_, i) =>
  entry({
    id: `o${i + 1}`,
    kind: i % 2 === 0 ? 'user_action' : 'ai_reply',
    content: `Corridor ${i + 1}: the gallery adds another wing each time you look away from it.`,
    position: i + 1,
  }),
)
// The memory banner's desktop height: it mounts above the reader as a pass starts.
const BANNER_HEIGHT_PX = 49

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

function readerScroller(): HTMLElement {
  const scroller = entryRow('o1').parentElement
  if (scroller == null) throw new Error('no reader scroller')
  return scroller
}

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

// The landing pin re-asserts the bottom per frame until the scroll height holds for 10
// frames; outlasting that keeps the pin from passing the shrink stories by itself.
async function settleLanding(scroller: HTMLElement) {
  await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  let stable = 0
  let lastHeight = -1
  while (stable < 20) {
    await nextFrame()
    stable = scroller.scrollHeight === lastHeight ? stable + 1 : 0
    lastHeight = scroller.scrollHeight
  }
}

async function scrollToDistance(scroller: HTMLElement, distancePx: number) {
  scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - distancePx
  await waitFor(() => expect(distanceFromBottom(scroller)).toBeCloseTo(distancePx, 0))
  await nextFrame()
}

// The decorator's fixed-height box is the reader's container, standing in for the shell.
async function resizeViewport(scroller: HTMLElement, deltaPx: number) {
  const box = scroller.parentElement?.parentElement
  if (box == null) throw new Error('no viewport box')
  const before = scroller.clientHeight
  box.style.height = `${box.offsetHeight + deltaPx}px`
  await waitFor(() => expect(scroller.clientHeight).toBe(before + deltaPx))
  await nextFrame()
  await nextFrame()
}

const shrinkViewport = (scroller: HTMLElement) => resizeViewport(scroller, -BANNER_HEIGHT_PX)

/** A reader at the bottom stays there when the banner mounts and takes viewport height. */
export const ShrinkAtBottomRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await shrinkViewport(scroller)
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  },
}

/** Inside the jump button's 20 px near-bottom tolerance counts as at the bottom. */
export const ShrinkNearBottomRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await scrollToDistance(scroller, 15)
    await shrinkViewport(scroller)
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  },
}

/** Further up than the tolerance, the reader is reading back: its position holds. */
export const ShrinkAwayFromBottomHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await scrollToDistance(scroller, 30)
    const scrollTop = scroller.scrollTop
    await shrinkViewport(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
    expect(distanceFromBottom(scroller)).toBeCloseTo(30 + BANNER_HEIGHT_PX, 0)
  },
}

/** Growth needs no re-pin: a reader inside the tolerance keeps its scrollTop as the box grows. */
export const GrowNearBottomHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await scrollToDistance(scroller, 15)
    const scrollTop = scroller.scrollTop
    await resizeViewport(scroller, 5)
    expect(scroller.scrollTop).toBe(scrollTop)
    expect(distanceFromBottom(scroller)).toBeCloseTo(10, 0)
  },
}

/** No programmatic write lands under a finger: a shrink while a touch is down holds. */
export const ShrinkDuringTouchHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }))
    const scrollTop = scroller.scrollTop
    await shrinkViewport(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
    expect(distanceFromBottom(scroller)).toBeCloseTo(BANNER_HEIGHT_PX, 0)
  },
}

/** A shrink skipped under a finger still moves the baseline the next shrink measures from. */
export const ShrinkAfterTouchKeepsBaseline: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }))
    await shrinkViewport(scroller)
    scroller.dispatchEvent(new Event('touchend', { bubbles: true }))
    // 40 px up: outside the tolerance against the current height, inside it (40 - 49) against
    // the height before the skipped shrink.
    await scrollToDistance(scroller, 40)
    const scrollTop = scroller.scrollTop
    await resizeViewport(scroller, -10)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/**
 * Content that grew below the viewport fires no scroll event, so only the geometry at the
 * shrink knows the reader had already left the bottom.
 */
export const ShrinkAfterSilentGrowthHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    entryRow('o14').style.paddingBottom = '80px'
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeGreaterThan(60))
    const scrollTop = scroller.scrollTop
    await shrinkViewport(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/**
 * The Android keyboard opening under an in-row editor shrinks the reader; pinning the bottom
 * then would push the editor up under the top.
 */
export const ShrinkWhileEditingHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await userEvent.click(rowButton('o13', t('reader:entryCard.editEntry')))
    const textarea = await waitFor(() =>
      screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
    )
    await waitFor(() => expect(textarea).toHaveFocus())
    await scrollToDistance(scroller, 0)
    const scrollTop = scroller.scrollTop
    await shrinkViewport(scroller)
    expect(textarea).toHaveFocus()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

// The keyboard's share of a phone's reader (the triage measurement left 180 CSS px above it).
const KEYBOARD_HEIGHT_PX = 260

/** The keyboard hides the last row's editor; the reader brings its row, Save included, back up. */
export const ShrinkWhileEditingRevealsTheEditor: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await userEvent.click(rowButton('o14', t('reader:entryCard.editEntry')))
    const textarea = await waitFor(() =>
      screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
    )
    await waitFor(() => expect(textarea).toHaveFocus())
    await scrollToDistance(scroller, 0)
    await resizeViewport(scroller, -KEYBOARD_HEIGHT_PX)
    expect(textarea).toHaveFocus()
    const save = within(entryRow('o14')).getByRole('button', { name: t('save') })
    await waitFor(() =>
      expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        scroller.getBoundingClientRect().bottom,
      ),
    )
  },
}

/**
 * On native the composer is a native view: tapping it leaves the reader document's activeElement
 * on an open editor but takes the document's focus, so the re-pin applies again.
 */
export const ShrinkWhileEditorLostFocusRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await userEvent.click(rowButton('o13', t('reader:entryCard.editEntry')))
    const textarea = await waitFor(() =>
      screen.getByRole('textbox', { name: t('reader:entryCard.editContent') }),
    )
    await waitFor(() => expect(textarea).toHaveFocus())
    await scrollToDistance(scroller, 0)
    const hasFocus = Document.prototype.hasFocus
    Document.prototype.hasFocus = () => false
    try {
      await shrinkViewport(scroller)
      await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
    } finally {
      Document.prototype.hasFocus = hasFocus
    }
  },
}

/** Focus in an editable outside the reader (the web composer shares its document) keeps the re-pin. */
export const ShrinkWhileOutsideEditableFocusedRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    const composer = document.createElement('textarea')
    document.body.append(composer)
    try {
      composer.focus()
      await shrinkViewport(scroller)
      expect(composer).toHaveFocus()
      await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
    } finally {
      composer.remove()
    }
  },
}

/** Only an editor holds the reader: a focused row button (a just-pressed Regenerate) keeps the re-pin. */
export const ShrinkWhileRowButtonFocusedRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    const button = rowButton('o14', t('reader:entryCard.regenerate'))
    button.focus()
    await shrinkViewport(scroller)
    expect(button).toHaveFocus()
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  },
}

const REPLY_TEXT = 'The corridor folds shut behind you.'
// Frames between the commit and the reply's late growth, inside the settle window: the per-frame
// loop is what absorbs layout that lands after the pin's first write.
const LATE_GROWTH_FRAMES = 5

// The surface across a stream's end: the streaming card gives way to its committed row, which
// then grows a few frames later.
function StreamEndHarness(props: ComponentProps<typeof ReaderSurface>) {
  const [phase, setPhase] = useState<'streaming' | 'committed' | 'grown'>('streaming')
  useEffect(() => {
    if (phase !== 'committed') return
    let frames = 0
    let raf = 0
    const tick = () => {
      frames += 1
      if (frames >= LATE_GROWTH_FRAMES) setPhase('grown')
      else raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])
  const reply = entry({
    id: 'reply',
    kind: 'ai_reply',
    content: phase === 'grown' ? `${REPLY_TEXT}\n\n${REPLY_TEXT}\n\n${REPLY_TEXT}` : REPLY_TEXT,
    position: OVERFLOW_ROWS.length + 1,
  })
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <button type="button" onClick={() => setPhase('committed')}>
        End stream
      </button>
      <div data-grown={phase === 'grown'} style={{ minHeight: 0, flex: 1 }}>
        <ReaderSurface
          {...props}
          rows={phase === 'streaming' ? OVERFLOW_ROWS : [...OVERFLOW_ROWS, reply]}
          streaming={phase === 'streaming' ? { content: REPLY_TEXT, reasoning: '' } : null}
        />
      </div>
    </div>
  )
}

// A plain click, so the play keeps its place inside the settle window; React commits the
// stream's end on the next microtask, before the frame waited for here.
async function endStream() {
  screen.getByRole('button', { name: 'End stream' }).click()
  await nextFrame()
}

async function replyGrown() {
  await waitFor(() =>
    expect(document.querySelector('[data-grown="true"]')).toBeInstanceOf(HTMLElement),
  )
  for (let i = 0; i < 3; i++) await nextFrame()
}

/** An engaged stream's end holds the bottom while the committed reply settles. */
export const StreamEndSettlesAtBottom: Story = {
  render: (args) => <StreamEndHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await endStream()
    await replyGrown()
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  },
}

/** A disengaged reader keeps its position through the stream's end. */
export const StreamEndDisengagedHolds: Story = {
  render: (args) => <StreamEndHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await scrollToDistance(scroller, 200)
    const scrollTop = scroller.scrollTop
    await endStream()
    await replyGrown()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** A wheel during the settle hands the position back to the user. */
export const StreamEndSettleBrokenByWheel: Story = {
  render: (args) => <StreamEndHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await endStream()
    // Inside the settle: the reply has committed and not yet grown.
    expect(entryRow('reply')).toBeInstanceOf(HTMLElement)
    expect(document.querySelector('[data-grown="false"]')).toBeInstanceOf(HTMLElement)
    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 100
    const scrollTop = scroller.scrollTop
    await replyGrown()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** A touch drag during the settle hands the position back to the user. */
export const StreamEndSettleBrokenByTouch: Story = {
  render: (args) => <StreamEndHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await endStream()
    expect(entryRow('reply')).toBeInstanceOf(HTMLElement)
    expect(document.querySelector('[data-grown="false"]')).toBeInstanceOf(HTMLElement)
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }))
    scroller.dispatchEvent(new Event('touchmove', { bubbles: true }))
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 100
    const scrollTop = scroller.scrollTop
    await replyGrown()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** An upward scroll key during the settle hands the position back to the user. */
export const StreamEndSettleBrokenByPageUp: Story = {
  render: (args) => <StreamEndHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await endStream()
    expect(entryRow('reply')).toBeInstanceOf(HTMLElement)
    expect(document.querySelector('[data-grown="false"]')).toBeInstanceOf(HTMLElement)
    // A dispatched key scrolls nothing, so the play makes the move the key would.
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight - 100
    const scrollTop = scroller.scrollTop
    await replyGrown()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

// A stream whose next chunk lands on a button press, so the play can move between chunks, beside
// a scroller standing in for the rail list: a focusable row over blank space.
function StreamChunksHarness(props: ComponentProps<typeof ReaderSurface>) {
  const [chunks, setChunks] = useState(1)
  const content = Array.from({ length: chunks }, () => REPLY_TEXT).join('\n\n')
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <button type="button" onClick={() => setChunks((n) => n + 1)}>
        Next chunk
      </button>
      <div style={{ display: 'flex', minHeight: 0, flex: 1 }}>
        <div data-rail-stand-in style={{ width: 120, overflowY: 'auto' }}>
          <button type="button">Rail row</button>
          <div style={{ height: 2000 }} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <ReaderSurface {...props} rows={OVERFLOW_ROWS} streaming={{ content, reasoning: '' }} />
        </div>
      </div>
    </div>
  )
}

function railStandIn(): HTMLElement {
  const rail = document.querySelector('[data-rail-stand-in]')
  if (!(rail instanceof HTMLElement)) throw new Error('no rail stand-in')
  return rail
}

async function nextChunk(scroller: HTMLElement) {
  const heightBefore = scroller.scrollHeight
  screen.getByRole('button', { name: 'Next chunk' }).click()
  await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(heightBefore))
  await nextFrame()
}

async function scrollSettled(el: HTMLElement) {
  let stable = 0
  let lastTop = -1
  while (stable < 10) {
    await nextFrame()
    stable = el.scrollTop === lastTop ? stable + 1 : 0
    lastTop = el.scrollTop
  }
}

/**
 * reader-composer.md → Autoscroll: an upward scroll key disengages an engaged stream, though its
 * move stays inside the at-bottom band the next chunk's re-pin would otherwise pull it out of.
 */
export const StreamFollowBrokenByArrowUp: Story = {
  render: (args) => <StreamChunksHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await scrollToDistance(scroller, 40)
    await nextChunk(scroller)
    expect(distanceFromBottom(scroller)).toBeGreaterThan(40)
  },
}

const RAIL_START_PX = 1000

/**
 * With nothing focused, Chromium scrolls the scroller last pressed: a key that scrolls the rail
 * leaves the reader following. Real input, a no-op outside Vitest: a dispatched key scrolls nothing.
 */
export const StreamFollowHoldsWhileRailScrollsByKey: Story = {
  render: (args) => <StreamChunksHarness {...args} />,
  play: async () => {
    const browser = await import('vitest/browser').catch(() => null)
    if (browser == null) return
    const scroller = readerScroller()
    await settleLanding(scroller)
    const rail = railStandIn()
    rail.scrollTop = RAIL_START_PX
    await scrollSettled(rail)
    await browser.userEvent.click(rail, { position: { x: 20, y: 200 } })
    expect(document.activeElement).toBe(document.body)
    const readerTop = scroller.scrollTop
    await browser.userEvent.keyboard('{PageUp}')
    await waitFor(() => expect(rail.scrollTop).toBeLessThan(RAIL_START_PX))
    await scrollSettled(rail)
    expect(scroller.scrollTop).toBe(readerTop)
    await nextChunk(scroller)
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
  },
}

/** With nothing focused, a key after a press inside the reader scrolls it, and disengages. */
export const StreamFollowBrokenByKeyAfterReaderPress: Story = {
  render: (args) => <StreamChunksHarness {...args} />,
  play: async () => {
    const browser = await import('vitest/browser').catch(() => null)
    if (browser == null) return
    const scroller = readerScroller()
    await settleLanding(scroller)
    const rail = railStandIn()
    rail.scrollTop = RAIL_START_PX
    await scrollSettled(rail)
    await browser.userEvent.click(entryRow('o14'), { position: { x: 4, y: 4 } })
    expect(document.activeElement).toBe(document.body)
    const readerTop = scroller.scrollTop
    await browser.userEvent.keyboard('{ArrowUp}')
    await waitFor(() => expect(scroller.scrollTop).toBeLessThan(readerTop))
    await scrollSettled(scroller)
    expect(rail.scrollTop).toBe(RAIL_START_PX)
    const distance = distanceFromBottom(scroller)
    expect(distance).toBeLessThan(80)
    await nextChunk(scroller)
    expect(distanceFromBottom(scroller)).toBeGreaterThan(distance)
  },
}

export const OlderBoundaryShimmer: Story = {
  args: { hasOlder: true },
}

export const Streaming: Story = {
  args: {
    streaming: {
      content: 'The corridor keeps unfolding as you walk, each step adding',
      reasoning: '',
    },
  },
}

// Composed through describeTurnFailure rather than literals so each bubble shows
// the copy the pipeline would actually persist, magnitude suffix included.
const PROVIDER_FAILURE = describeTurnFailure({
  kind: 'provider',
  reason: 'auth',
  detail: 'provider returned 401 — invalid API key',
})

// No fix action: useSystemEntryActions yields one only for config-resolver and
// embedder failures, so a provider bubble carries Retry and Dismiss alone.
export const SystemFailure: Story = {
  args: {
    rows: [
      ...ROWS,
      entry({
        id: 'e6',
        kind: 'system',
        content: PROVIDER_FAILURE.content,
        position: 6,
        metadata: {
          ...BASE_META,
          systemFailure: { kind: 'provider', detail: PROVIDER_FAILURE.detail },
        },
      }),
    ],
  },
}

const EMBED_FAILURE = describeTurnFailure({
  kind: 'embedder',
  reason: 'call',
  detail: 'embedding request failed: 503',
  staleCount: 2,
})

export const EmbedderFailure: Story = {
  args: {
    rows: [
      ...ROWS,
      entry({
        id: 'e6',
        kind: 'system',
        content: EMBED_FAILURE.content,
        position: 6,
        metadata: {
          ...BASE_META,
          systemFailure: { kind: 'embedder', detail: EMBED_FAILURE.detail },
        },
      }),
    ],
    systemFixLabel: t('reader:systemEntry.switchEmbedder'),
  },
}

// Composed through the helpers the host writes the entry with, so each bubble shows real copy.
const HELD_PASS = describePassFailure({ held: true }, undefined)
// A Send refused on a held branch always leaves its text on the entry.
const HELD_SUBMISSION = { content: 'I study the empty frame.', composerMode: 'free' }
const HELD_PASS_TEXT_KEPT = describePassFailure({ held: true }, HELD_SUBMISSION)
const FAILED_PASS_ERROR = {
  kind: 'provider',
  reason: 'timeout',
  detail: 'classifier: timeout after 600000ms',
} as const
const FAILED_PASS = describePassFailure({ held: false, error: FAILED_PASS_ERROR }, undefined)

function passFailureRows(content: string, failure: SystemFailureMeta): StoryEntry[] {
  return [
    ...ROWS,
    entry({
      id: 'e6',
      kind: 'system',
      content,
      position: 6,
      metadata: { ...BASE_META, systemFailure: failure },
    }),
  ]
}

// A held branch can't run a pass, so the host passes no Retry handler: Dismiss alone.
export const PassFailureHeld: Story = {
  args: {
    rows: passFailureRows(HELD_PASS.content, toPassFailureMeta({ held: true }, undefined)),
    onRetrySystemEntry: undefined,
  },
  play: async () => {
    const row = entryRow('e6')
    expect(within(row).getByRole('button', { name: /Dismiss/ })).toBeVisible()
    expect(within(row).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  },
}

export const PassFailureHeldTextKept: Story = {
  args: {
    rows: passFailureRows(
      HELD_PASS_TEXT_KEPT.content,
      toPassFailureMeta({ held: true }, HELD_SUBMISSION),
    ),
    onRetrySystemEntry: undefined,
  },
  play: async () => {
    const row = entryRow('e6')
    expect(within(row).getByText(t('reader:systemEntry.failure.memoryHeld'))).toBeVisible()
    expect(
      within(row).queryByText(t('reader:systemEntry.failure.memoryHeldNoText')),
    ).not.toBeInTheDocument()
    expect(within(row).getByRole('button', { name: /Dismiss/ })).toBeVisible()
    expect(within(row).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  },
}

const RESOLVED_PASS = passResolvedEntry({ content: 'I wade in after it.', composerMode: 'free' })

// A Retry committed over an occupied draft: the entry stays to hold the text, Dismiss alone.
export const PassResolvedTextKept: Story = {
  args: {
    rows: passFailureRows(RESOLVED_PASS.content, RESOLVED_PASS.failure),
    onRetrySystemEntry: undefined,
  },
}

// The control for the held stories: with the handler, a failed pass entry offers Retry.
export const PassFailureRetry: Story = {
  args: {
    rows: passFailureRows(
      FAILED_PASS.content,
      toPassFailureMeta({ held: false, error: FAILED_PASS_ERROR }, undefined),
    ),
    onRetrySystemEntry: fn(async () => {}),
  },
  play: async ({ args }) => {
    await userEvent.click(within(entryRow('e6')).getByRole('button', { name: /Retry/ }))
    await waitFor(() => expect(args.onRetrySystemEntry).toHaveBeenCalledTimes(1))
  },
}
