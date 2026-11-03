import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { EARTH_GREGORIAN } from '@/lib/calendar'
import type { CutOffMark, StoryEntry, SystemFailureMeta } from '@/lib/db'
import { t } from '@/lib/i18n'

import type { ChapterBreaks } from './chapter-breaks'
import type { ReaderSurfaceHandle } from './reader-document-types'
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
    contentTokens: null,
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
  onCopySystemText: async () => {},
  onFixSystemEntry: async () => {},
  onFixCutOff: async () => {},
  onEntryLanded: async () => {},
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
    chapterBreaks: {},
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

// A phone keyboard's share of the reader: on a 411×914 dp emulator it leaves the reader 180 CSS px.
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

// Handle calls from a button, as the host's would arrive: `o_later` is a row no commit brings.
function LandingSignalHarness(props: ComponentProps<typeof ReaderSurface>) {
  const ref = useRef<ReaderSurfaceHandle>(null)
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <button type="button" onClick={() => ref.current?.jumpToEntry('o1')}>
        Jump to o1
      </button>
      <button type="button" onClick={() => ref.current?.jumpToEntry('o_later')}>
        Jump to a later row
      </button>
      <div style={{ minHeight: 0, flex: 1 }}>
        <ReaderSurface {...props} ref={ref} />
      </div>
    </div>
  )
}

// The landed frame, then a double rAF; the loop's settle end comes ten frames later.
const LANDED_SIGNAL_FRAMES = 5

/** The host's veil lifts on a landing's first painted write, and only once. */
export const EntryLandedOnLanding: Story = {
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  render: (args) => <LandingSignalHarness {...args} />,
  play: async ({ args }) => {
    await settleLanding(readerScroller())
    screen.getByRole('button', { name: 'Jump to o1' }).click()
    for (let i = 0; i < LANDED_SIGNAL_FRAMES; i++) await nextFrame()
    expect(args.onEntryLanded).toHaveBeenCalledTimes(1)
    expect(args.onEntryLanded).toHaveBeenCalledWith('o1')
    expect(entryRow('o1')).toHaveAttribute('data-landed')
    for (let i = 0; i < 20; i++) await nextFrame()
    expect(args.onEntryLanded).toHaveBeenCalledTimes(1)
  },
}

/** A row already in place lands without a write, and must still lift the veil. */
export const EntryLandedWithoutAWrite: Story = {
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  render: (args) => <JumpHarness {...args} />,
  play: async ({ args }) => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    await outlastLanding()
    expect(args.onEntryLanded).toHaveBeenCalledTimes(1)
    const landedTop = scroller.scrollTop
    press('Jump')
    for (let i = 0; i < LANDED_SIGNAL_FRAMES; i++) await nextFrame()
    expect(args.onEntryLanded).toHaveBeenCalledTimes(2)
    expect(scroller.scrollTop).toBe(landedTop)
  },
}

/** A jump between a landing and its paint replaces it: the newer target must not report early. */
export const EntryLandedNotForAReplacingJump: Story = {
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  render: (args) => <LandingSignalHarness {...args} />,
  play: async ({ args }) => {
    await settleLanding(readerScroller())
    const replaced = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!entryRow('o1').hasAttribute('data-landed')) return
        observer.disconnect()
        screen.getByRole('button', { name: 'Jump to a later row' }).click()
        resolve()
      })
      observer.observe(entryRow('o1'), { attributes: true })
    })
    screen.getByRole('button', { name: 'Jump to o1' }).click()
    await replaced
    for (let i = 0; i < 20; i++) await nextFrame()
    expect(args.onEntryLanded).toHaveBeenCalledTimes(1)
    expect(args.onEntryLanded).toHaveBeenCalledWith('o1')
  },
}

/** A wheel drops a target that never arrived, and the veil must still lift. */
export const EntryLandedOnDroppedTarget: Story = {
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  render: (args) => <LandingSignalHarness {...args} />,
  play: async ({ args }) => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    await userEvent.click(screen.getByRole('button', { name: 'Jump to a later row' }))
    for (let i = 0; i < 5; i++) await nextFrame()
    expect(args.onEntryLanded).not.toHaveBeenCalled()

    scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))
    await waitFor(() => expect(args.onEntryLanded).toHaveBeenCalledWith('o_later'))
  },
}

/** A reload that drops the row before it lands ends the landing, and the veil must still lift. */
export const EntryLandedOnDetachedRow: Story = {
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  render: (args) => <JumpHarness {...args} />,
  play: async ({ args }) => {
    await settleLanding(scrollerOf('o1'))
    press('Jump')
    press('Drop target')
    await waitFor(() => expect(args.onEntryLanded).toHaveBeenCalledWith(JUMP_TARGET))
    expect(screen.queryByText(/Corridor 3:/)).toBeNull()
  },
}

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

/** Only an upward key takes the reader off the live edge: a downward one leaves it following. */
export const StreamFollowHoldsThroughADownwardKey: Story = {
  render: (args) => <StreamChunksHarness {...args} />,
  play: async () => {
    const scroller = readerScroller()
    await settleLanding(scroller)
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    await nextChunk(scroller)
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
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

/** Below its end row, as the row's sibling: inside ReaderRow it would void the memo. */
export const ChapterBreakBelowItsEndRow: Story = {
  args: { chapterBreaks: { e3: { number: 3, timeLabel: 'Day 12 · 14:33' } } },
  play: async () => {
    const rule = await screen.findByRole('separator', { name: 'Chapter 3 · Day 12 · 14:33' })
    expect(rule).toHaveTextContent('Chapter 3 · Day 12 · 14:33')
    expect(entryRow('e3').nextElementSibling).toBe(rule)
    expect(rule.nextElementSibling).toBe(entryRow('e4'))
  },
}

/** No decoration on the end row means no time, and the label stands alone. */
export const ChapterBreakWithoutTime: Story = {
  args: { chapterBreaks: { e3: { number: 3 } } },
  play: async () => {
    const rule = await screen.findByRole('separator', { name: 'Chapter 3' })
    expect(rule).toHaveTextContent(/^Chapter 3$/)
  },
}

type BreakCommitProps = ComponentProps<typeof ReaderSurface> & {
  after: { rows?: StoryEntry[]; chapterBreaks?: ChapterBreaks }
  jumpTo?: string
}

// One commit on a press, so the play can place the reader first. A jump is called ahead of the
// commit, as the host's is: useEntryJump lands right after its store write.
function BreakCommitHarness({ after, jumpTo, ...props }: BreakCommitProps) {
  const surfaceRef = useRef<ReaderSurfaceHandle>(null)
  const [committed, setCommitted] = useState(false)
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <button
        type="button"
        onClick={() => {
          if (jumpTo != null) surfaceRef.current?.jumpToEntry(jumpTo)
          setCommitted(true)
        }}
      >
        Commit
      </button>
      <div style={{ minHeight: 0, flex: 1 }}>
        <ReaderSurface {...props} {...(committed ? after : {})} ref={surfaceRef} />
      </div>
    </div>
  )
}

const topBelowReaderEdge = (el: Element, scroller: HTMLElement) =>
  el.getBoundingClientRect().top - scroller.getBoundingClientRect().top

async function pressCommit() {
  screen.getByRole('button', { name: 'Commit' }).click()
  await nextFrame()
  await nextFrame()
}

const LATE_BREAK = { o12: { number: 2, timeLabel: 'Day 2, dawn' } }

/** A close landing under a reader at the bottom leaves it at the bottom. */
export const BreakAtBottomRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  render: (args) => <BreakCommitHarness {...args} after={{ chapterBreaks: LATE_BREAK }} />,
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await pressCommit()
    await screen.findByRole('separator', { name: 'Chapter 2 · Day 2, dawn' })
    await scrollSettled(scroller)
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
  },
}

/** The tolerance reads the height before the break: its own height must not push a reader out. */
export const BreakNearBottomRepins: Story = {
  args: { rows: OVERFLOW_ROWS },
  render: (args) => <BreakCommitHarness {...args} after={{ chapterBreaks: LATE_BREAK }} />,
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await scrollToDistance(scroller, 15)
    await pressCommit()
    await scrollSettled(scroller)
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
  },
}

/** Further up nothing is written, though a break above the viewport shifts content. */
export const BreakAwayFromBottomWritesNothing: Story = {
  args: { rows: OVERFLOW_ROWS },
  render: (args) => (
    <BreakCommitHarness {...args} after={{ chapterBreaks: { o2: { number: 2 } } }} />
  ),
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await scrollToDistance(scroller, 200)
    const scrollTop = scroller.scrollTop
    await pressCommit()
    await scrollSettled(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** Nothing is written under a finger, even for a reader at the bottom. */
export const BreakDuringTouchHolds: Story = {
  args: { rows: OVERFLOW_ROWS },
  render: (args) => <BreakCommitHarness {...args} after={{ chapterBreaks: LATE_BREAK }} />,
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const scrollTop = scroller.scrollTop
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }))
    await pressCommit()
    await scrollSettled(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/**
 * A boundary load carrying a break: the anchor rule's scrollTop write in that commit must not read
 * as a reader at the bottom, or the prepend would throw it to the far end.
 */
export const BreakInBoundaryLoadHolds: Story = {
  args: { rows: OVERFLOW_ROWS.slice(6) },
  render: (args) => (
    <BreakCommitHarness
      {...args}
      after={{ rows: OVERFLOW_ROWS, chapterBreaks: { o3: { number: 2 } } }}
    />
  ),
  play: async () => {
    const scroller = scrollerOf('o7')
    await settleLanding(scroller)
    scroller.scrollTop = 0
    await scrollSettled(scroller)
    await pressCommit()
    expect(entryRow('o1')).toBeInstanceOf(HTMLElement)
    // Read before the settle too: the hold would restore a thrown reader, after a visible jump.
    expect(topBelowReaderEdge(entryRow('o7'), scroller)).toBeCloseTo(0, 0)
    await scrollSettled(scroller)
    expect(topBelowReaderEdge(entryRow('o7'), scroller)).toBeCloseTo(0, 0)
  },
}

/** A target still waiting for its row owns the position: nothing pins under a pending jump. */
export const BreakWhileJumpPendingHolds: Story = {
  args: { rows: OVERFLOW_ROWS.slice(1) },
  render: (args) => (
    <BreakCommitHarness {...args} after={{ chapterBreaks: LATE_BREAK }} jumpTo="o1" />
  ),
  play: async () => {
    const scroller = scrollerOf('o2')
    await settleLanding(scroller)
    const scrollTop = scroller.scrollTop
    await pressCommit()
    await scrollSettled(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** A jump to a chapter's start opens under the heading that names it. */
export const LandingOpensUnderTheBreak: Story = {
  args: { rows: OVERFLOW_ROWS, chapterBreaks: { o5: { number: 2, timeLabel: 'Day 2, dawn' } } },
  render: (args) => <BreakCommitHarness {...args} after={{}} jumpTo="o6" />,
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await pressCommit()
    await waitFor(() => expect(entryRow('o6')).toHaveAttribute('data-landed'))
    await scrollSettled(scroller)
    const rule = screen.getByRole('separator', { name: 'Chapter 2 · Day 2, dawn' })
    expect(Math.abs(topBelowReaderEdge(rule, scroller) - 12)).toBeLessThan(2)
  },
}

/** The first chapter has no break above it. The shimmer leaves room to land the row itself. */
export const LandingOnTheFirstChapterHasNoBreak: Story = {
  args: {
    rows: OVERFLOW_ROWS,
    hasOlder: true,
    chapterBreaks: { o5: { number: 2, timeLabel: 'Day 2, dawn' } },
  },
  render: (args) => <BreakCommitHarness {...args} after={{}} jumpTo="o1" />,
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await pressCommit()
    await scrollSettled(scroller)
    expect(Math.abs(topBelowReaderEdge(entryRow('o1'), scroller) - 12)).toBeLessThan(2)
  },
}

/** A long jump mounts breaks in the same commit as its rows; no pin drags it back down. */
export const JumpMountingBreaksLands: Story = {
  args: { rows: OVERFLOW_ROWS.slice(8) },
  render: (args) => (
    <BreakCommitHarness
      {...args}
      after={{
        rows: OVERFLOW_ROWS,
        chapterBreaks: { o3: { number: 2 }, o11: { number: 3 } },
      }}
      jumpTo="o4"
    />
  ),
  play: async () => {
    const scroller = scrollerOf('o9')
    await settleLanding(scroller)
    await pressCommit()
    await scrollSettled(scroller)
    const rule = screen.getByRole('separator', { name: 'Chapter 2' })
    expect(Math.abs(topBelowReaderEdge(rule, scroller) - 12)).toBeLessThan(2)
  },
}

type BreakStepsProps = ComponentProps<typeof ReaderSurface> & {
  steps: { rows?: StoryEntry[]; chapterBreaks?: ChapterBreaks }[]
}

function BreakStepsHarness({ steps, ...props }: BreakStepsProps) {
  const [step, setStep] = useState(0)
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <button type="button" onClick={() => setStep((n) => n + 1)}>
        Next step
      </button>
      <div style={{ minHeight: 0, flex: 1 }}>
        <ReaderSurface {...props} {...(step > 0 ? steps[step - 1] : {})} />
      </div>
    </div>
  )
}

async function pressNextStep(scroller: HTMLElement) {
  screen.getByRole('button', { name: 'Next step' }).click()
  await frames(3)
  await scrollSettled(scroller)
}

/** A commit made while the reader had no layout leaves no height for a later break to read. */
export const BreakAfterHiddenCommitWritesNothing: Story = {
  args: { rows: OVERFLOW_ROWS },
  render: (args) => (
    <BreakStepsHarness {...args} steps={[{}, { chapterBreaks: { o3: { number: 2 } } }]} />
  ),
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await scrollToDistance(scroller, 300)
    const scrollTop = scroller.scrollTop
    const box = scroller.parentElement?.parentElement
    if (box == null) throw new Error('no reader box')
    box.style.display = 'none'
    await pressNextStep(scroller)
    box.style.display = ''
    await frames(3)
    expect(scroller.scrollTop).toBe(scrollTop)
    await pressNextStep(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** Rows growing below a reader that doesn't follow move the bottom away before a break lands. */
export const BreakAfterGrowthBelowWritesNothing: Story = {
  args: { rows: OVERFLOW_ROWS.slice(0, 12) },
  render: (args) => (
    <BreakStepsHarness
      {...args}
      steps={[
        { rows: OVERFLOW_ROWS },
        { rows: OVERFLOW_ROWS, chapterBreaks: { o3: { number: 2 } } },
      ]}
    />
  ),
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    await pressNextStep(scroller)
    const scrollTop = scroller.scrollTop
    expect(distanceFromBottom(scroller)).toBeGreaterThan(20)
    await pressNextStep(scroller)
    expect(scroller.scrollTop).toBe(scrollTop)
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
const HELD_PASS = describePassFailure({ held: true })
// A Send refused on a held branch always leaves its text on the entry; a failed pass leaves it
// only when the composer couldn't take it back.
const KEPT_SUBMISSION = { content: 'I study the empty frame.', composerMode: 'free' }
const FAILED_PASS_ERROR = {
  kind: 'provider',
  reason: 'timeout',
  detail: 'classifier: timeout after 600000ms',
} as const
const FAILED_PASS = describePassFailure({ held: false, error: FAILED_PASS_ERROR })

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
    expect(within(row).queryByText(t('reader:systemEntry.heldTextLabel'))).not.toBeInTheDocument()
  },
}

// Same copy as PassFailureHeld; the row's kept text shows as a quote under it.
export const PassFailureHeldTextKept: Story = {
  args: {
    rows: passFailureRows(HELD_PASS.content, toPassFailureMeta({ held: true }, KEPT_SUBMISSION)),
    onRetrySystemEntry: undefined,
  },
  play: async () => {
    const row = entryRow('e6')
    expect(within(row).getByText(t('reader:systemEntry.failure.memoryHeld'))).toBeVisible()
    expect(within(row).getByText(KEPT_SUBMISSION.content)).toBeVisible()
    expect(within(row).getByText(t('reader:systemEntry.heldTextCustody'))).toBeVisible()
    expect(within(row).getByRole('button', { name: /Dismiss/ })).toBeVisible()
    expect(within(row).queryByRole('button', { name: /Retry/ })).not.toBeInTheDocument()
  },
}

// A blank submission is nothing to keep: no quote over whitespace.
export const PassFailureHeldBlankText: Story = {
  args: {
    rows: passFailureRows(
      HELD_PASS.content,
      toPassFailureMeta({ held: true }, { content: ' \n ', composerMode: 'free' }),
    ),
    onRetrySystemEntry: undefined,
  },
  play: async () => {
    const row = entryRow('e6')
    expect(within(row).getByText(t('reader:systemEntry.failure.memoryHeld'))).toBeVisible()
    expect(within(row).queryByText(t('reader:systemEntry.heldTextLabel'))).not.toBeInTheDocument()
  },
}

const RESOLVED_PASS = passResolvedEntry({ content: 'I wade in after it.', composerMode: 'free' })

// A Retry committed over an occupied draft: the entry stays to hold the text, Dismiss alone.
export const PassResolvedTextKept: Story = {
  args: {
    rows: passFailureRows(RESOLVED_PASS.content, RESOLVED_PASS.failure),
    onRetrySystemEntry: undefined,
  },
  play: async () => {
    const row = entryRow('e6')
    expect(within(row).getByText('I wade in after it.')).toBeVisible()
    expect(within(row).getByText(t('reader:systemEntry.heldTextCustody'))).toBeVisible()
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

const FAILED_PASS_KEPT = toPassFailureMeta(
  { held: false, error: FAILED_PASS_ERROR },
  KEPT_SUBMISSION,
)

/** Both copy buttons reach the host with the row's stored strings, verbatim. */
export const SystemEntryCopy: Story = {
  args: {
    rows: passFailureRows(FAILED_PASS.content, FAILED_PASS_KEPT),
    onCopySystemText: fn(async () => {}),
  },
  play: async ({ args }) => {
    const row = entryRow('e6')
    await userEvent.click(
      within(row).getByRole('button', { name: t('reader:systemEntry.copyHeldText') }),
    )
    await waitFor(() =>
      expect(args.onCopySystemText).toHaveBeenLastCalledWith(KEPT_SUBMISSION.content),
    )
    await userEvent.click(
      within(row).getByRole('button', { name: t('reader:systemEntry.details') }),
    )
    await userEvent.click(
      await within(row).findByRole('button', { name: t('reader:systemEntry.copyDetails') }),
    )
    await waitFor(() =>
      expect(args.onCopySystemText).toHaveBeenLastCalledWith(FAILED_PASS_KEPT.detail),
    )
  },
}

// Taller than the 24px in view under the toggle: the card's p-4 plus the row frame's py-2.
const MULTI_LINE_DETAIL = [
  'timeout: classifier: timeout after 600000ms',
  'POST /v1/chat/completions',
  'attempt 1 of 3: no response',
  'attempt 2 of 3: no response',
  'attempt 3 of 3: no response',
].join('\n')

/**
 * Landed at the bottom, opening the tail entry's `Details` grows the content below the fold, and
 * no autoscroll rule follows tail growth: the reveal alone brings the detail into view.
 */
export const SystemEntryRevealAtTail: Story = {
  args: {
    rows: passFailureRows(FAILED_PASS.content, { ...FAILED_PASS_KEPT, detail: MULTI_LINE_DETAIL }),
  },
  play: async () => {
    const row = entryRow('e6')
    const scroller = row.parentElement
    if (scroller == null) throw new Error('no reader scroller')
    await settleLanding(scroller)
    await userEvent.click(
      within(row).getByRole('button', { name: t('reader:systemEntry.details') }),
    )
    // A function matcher: the default one collapses the detail's line breaks.
    const detail = await within(row).findByText(
      (_, node) => node?.childElementCount === 0 && node.textContent === MULTI_LINE_DETAIL,
    )
    await waitFor(() =>
      expect(detail.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        scroller.getBoundingClientRect().bottom + 1,
      ),
    )
  },
}

// A reply cut off in its prose, committed with the mark the narrative phase writes.
function cutOffRows(cutOff: CutOffMark): StoryEntry[] {
  return [
    ...ROWS,
    entry({
      id: 'e6',
      kind: 'ai_reply',
      content: 'The east wing folds into the west, and the map in your hands',
      position: 6,
      metadata: { ...BASE_META, cutOff },
    }),
  ]
}

/** The row builds the notice from the stored mark, and `Fix profile` reaches the host. */
export const CutOffNoticeFixProfile: Story = {
  args: {
    rows: cutOffRows({ cause: 'max-output', outputTokens: 4096, limit: 4096 }),
    cutOffFixLabel: t('reader:systemEntry.fixProfile'),
    onFixCutOff: fn(async () => {}),
  },
  play: async ({ args }) => {
    const row = entryRow('e6')
    await expect(
      within(row).getByText("Cut off at the narrative profile's 4,096-token max output."),
    ).toBeVisible()
    await userEvent.click(within(row).getByRole('button', { name: 'Fix profile' }))
    await waitFor(() => expect(args.onFixCutOff).toHaveBeenCalledTimes(1))
  },
}

/** An unknown cut-off offers `Fix profile` too, like a max-output one. */
export const CutOffNoticeUnknownFixProfile: Story = {
  args: {
    rows: cutOffRows({ cause: 'unknown', outputTokens: 2048 }),
    cutOffFixLabel: t('reader:systemEntry.fixProfile'),
    onFixCutOff: fn(async () => {}),
  },
  play: async ({ args }) => {
    const row = entryRow('e6')
    await expect(
      within(row).getByText(
        'The server stopped the reply at its own limit. Setting a max output on the profile overrides it.',
      ),
    ).toBeVisible()
    await userEvent.click(within(row).getByRole('button', { name: 'Fix profile' }))
    await waitFor(() => expect(args.onFixCutOff).toHaveBeenCalledTimes(1))
  },
}

/** An unknown cut-off short of the profile's max output names that limit and keeps `Fix profile`. */
export const CutOffNoticeShortOfMaxOutput: Story = {
  args: {
    rows: cutOffRows({ cause: 'unknown', outputTokens: 300, maxOutput: 4096 }),
    cutOffFixLabel: t('reader:systemEntry.fixProfile'),
    onFixCutOff: fn(async () => {}),
  },
  play: async ({ args }) => {
    const row = entryRow('e6')
    await expect(
      within(row).getByText(
        "The server stopped the reply at its own limit, short of the narrative profile's 4,096-token max output.",
      ),
    ).toBeVisible()
    await userEvent.click(within(row).getByRole('button', { name: 'Fix profile' }))
    await waitFor(() => expect(args.onFixCutOff).toHaveBeenCalledTimes(1))
  },
}

/** A window cut-off is fixed via `Set window`: no `Fix profile`, even with a label. */
export const CutOffNoticeWindowHasNoFix: Story = {
  args: {
    rows: cutOffRows({ cause: 'window', outputTokens: 1200, limit: 65536 }),
    cutOffFixLabel: t('reader:systemEntry.fixProfile'),
  },
  play: async () => {
    const row = entryRow('e6')
    await expect(
      within(row).getByText(
        "Cut off where the prompt and reply filled the model's 65,536-token window.",
      ),
    ).toBeVisible()
    expect(within(row).queryByRole('button', { name: 'Fix profile' })).not.toBeInTheDocument()
  },
}

/** No label from the host, no action: the text alone. */
export const CutOffNoticeWithoutFixLabel: Story = {
  args: {
    rows: cutOffRows({ cause: 'unknown', outputTokens: 2048 }),
  },
  play: async () => {
    const row = entryRow('e6')
    await expect(
      within(row).getByText(
        'The server stopped the reply at its own limit. Setting a max output on the profile overrides it.',
      ),
    ).toBeVisible()
    expect(within(row).queryByRole('button', { name: 'Fix profile' })).not.toBeInTheDocument()
  },
}

const LANDING_GAP_PX = 12
const JUMP_TARGET = 'o3'
const contentReads = { count: 0 }
const GROWN_CONTENT = Array.from({ length: 8 }, () => REPLY_TEXT.repeat(6)).join('\n\n')
const PARTIAL_ROWS = OVERFLOW_ROWS.slice(7)

const grownAboveTarget = (row: StoryEntry): StoryEntry =>
  row.id === 'o2' ? { ...row, content: GROWN_CONTENT } : row

// The host around a jump: each button is one thing the route or the bridge does to the surface.
function JumpHarness(props: ComponentProps<typeof ReaderSurface>) {
  const surfaceRef = useRef<ReaderSurfaceHandle>(null)
  const [rows, setRows] = useState(props.rows)
  const [branchKey, setBranchKey] = useState(props.branchKey)
  const [hasOlder, setHasOlder] = useState(props.hasOlder)
  const [chunks, setChunks] = useState(0)
  const content = Array.from({ length: chunks }, () => REPLY_TEXT).join('\n\n')
  const actions = {
    Jump: () => surfaceRef.current?.jumpToEntry(JUMP_TARGET),
    'Jump to tail': () => surfaceRef.current?.jumpToEntry('o14'),
    'Bottom button': () => surfaceRef.current?.jumpToBottom(),
    'Load all rows': () => setRows(OVERFLOW_ROWS),
    'Prepend and grow': () =>
      setRows((current) => [OVERFLOW_ROWS[0]!, ...current].map(grownAboveTarget)),
    'Grow above target': () => setRows((current) => current.map(grownAboveTarget)),
    'Drop target': () => setRows((current) => current.filter((row) => row.id !== JUMP_TARGET)),
    'Switch branch': () => {
      setBranchKey('branch_other')
      setRows(OVERFLOW_ROWS.map((row) => ({ ...row, branchId: 'branch_other' })))
    },
    'Next chunk': () => setChunks((n) => n + 1),
    'Prove branch top': () => setHasOlder(false),
  }
  return (
    <div style={{ display: 'flex', height: '100%', flexDirection: 'column' }}>
      <div>
        {Object.entries(actions).map(([label, onClick]) => (
          <button key={label} type="button" onClick={onClick}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ minHeight: 0, flex: 1 }}>
        <ReaderSurface
          {...props}
          ref={surfaceRef}
          rows={rows}
          branchKey={branchKey}
          hasOlder={hasOlder}
          streaming={chunks > 0 ? { content, reasoning: '' } : null}
        />
      </div>
    </div>
  )
}

const press = (name: string) => screen.getByRole('button', { name }).click()

async function frames(count: number) {
  for (let i = 0; i < count; i++) await nextFrame()
}

function scrollerOf(rowId: string): HTMLElement {
  const scroller = entryRow(rowId).parentElement
  if (scroller == null) throw new Error('no reader scroller')
  return scroller
}

function topOffset(rowId: string, scroller: HTMLElement): number {
  return entryRow(rowId).getBoundingClientRect().top - scroller.getBoundingClientRect().top
}

async function landedOn(rowId: string, scroller: HTMLElement) {
  await waitFor(() =>
    expect(Math.abs(topOffset(rowId, scroller) - LANDING_GAP_PX)).toBeLessThan(1.5),
  )
}

// Past the loop's own 10 settled frames, so a pass means it held rather than hadn't moved yet.
const outlastLanding = () => frames(20)

// A scrollbar press: on the scroller itself, past its client width.
function pressScrollbar(scroller: HTMLElement) {
  const box = scroller.getBoundingClientRect()
  scroller.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      clientX: box.left + scroller.clientWidth + 2,
      clientY: box.top + 10,
    }),
  )
}

// Each stands in for a gesture the reader treats as the user taking over.
const LANDING_BREAKERS: Record<string, (scroller: HTMLElement) => void> = {
  wheelUp: (s) => s.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })),
  wheelDown: (s) => s.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true })),
  touchDrag: (s) => {
    s.dispatchEvent(new Event('touchstart', { bubbles: true }))
    s.dispatchEvent(new Event('touchmove', { bubbles: true }))
    s.dispatchEvent(new Event('touchend', { bubbles: true }))
  },
  scrollbarPress: pressScrollbar,
  upwardKey: (s) => s.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })),
}

// The loop would pull the view back on the next frame, so the row growing above the target is
// what tells a broken landing from one that merely hadn't written yet.
function landingBrokenBy(breaker: (scroller: HTMLElement) => void): Story {
  return {
    render: (args) => <JumpHarness {...args} />,
    args: { rows: OVERFLOW_ROWS },
    play: async () => {
      const scroller = scrollerOf('o1')
      await settleLanding(scroller)
      press('Jump')
      await landedOn(JUMP_TARGET, scroller)
      breaker(scroller)
      press('Grow above target')
      await nextFrame()
      const offset = topOffset(JUMP_TARGET, scroller)
      expect(offset).toBeGreaterThan(LANDING_GAP_PX + 100)
      await outlastLanding()
      expect(topOffset(JUMP_TARGET, scroller)).toBe(offset)
    },
  }
}

/** A row in the window lands under the viewport's top at once, marked for the highlight. */
export const JumpLandsRowInWindow: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    const row = entryRow(JUMP_TARGET)
    expect(row).toHaveAttribute('data-landed')
    const card = row.querySelector<HTMLElement>(':scope > .reader-entry-card')
    expect(card).not.toBeNull()
    if (card == null) return
    expect(getComputedStyle(card).animationName).toBe('reader-card-landed')
    expect(getComputedStyle(card).animationDuration).toBe('1.5s')
    expect(getComputedStyle(row).animationName).toBe('none')
    expect(getComputedStyle(row).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    const animations = card.getAnimations()
    expect(animations).toHaveLength(1)
    const tint = animations[0]
    // A slow landing can resolve after the fade's first frame; the seek reads its start colour.
    tint.currentTime = 0
    const probe = document.createElement('div')
    probe.style.backgroundColor = 'var(--selection-bg)'
    document.body.append(probe)
    try {
      expect(getComputedStyle(card).backgroundColor).toBe(getComputedStyle(probe).backgroundColor)
    } finally {
      probe.remove()
    }
    const landedBackground = getComputedStyle(card).backgroundColor
    expect(document.querySelectorAll('[data-landed]')).toHaveLength(1)
    await waitFor(() => expect(row).not.toHaveAttribute('data-landed'), { timeout: 4_000 })
    expect(getComputedStyle(card).animationName).toBe('none')
    expect(getComputedStyle(card).backgroundColor).not.toBe(landedBackground)
  },
}

function paintedPixel(...layers: string[]): number[] {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx == null) throw new Error('2d canvas unavailable')
  for (const layer of layers) {
    ctx.fillStyle = '#ff00ff'
    ctx.fillStyle = layer
    expect(ctx.fillStyle, `canvas rejected "${layer}"`).not.toBe('#ff00ff')
    ctx.fillRect(0, 0, 1, 1)
  }
  return Array.from(ctx.getImageData(0, 0, 1, 1).data)
}

/** In a dark theme the landed tint is a 30% layer over the card's own background. */
export const JumpLandsRowInWindowDark: Story = {
  globals: { theme: 'default-dark' },
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    expect(document.documentElement).toHaveClass('dark')
    expect(document.documentElement).toHaveAttribute('data-theme', 'default-dark')
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    const row = entryRow(JUMP_TARGET)
    const card = row.querySelector<HTMLElement>(':scope > .reader-entry-card')
    expect(card).not.toBeNull()
    if (card == null) return
    expect(getComputedStyle(card).animationName).toBe('reader-card-landed-dark')
    expect(getComputedStyle(card).animationDuration).toBe('1.5s')
    expect(getComputedStyle(card).animationTimingFunction).toBe('ease-out')
    const animations = card.getAnimations()
    expect(animations).toHaveLength(1)
    const tint = animations[0]
    // A slow landing can resolve after the fade's first frame; the seek reads its start colour.
    tint.currentTime = 0
    const cardBackground = getComputedStyle(card).backgroundColor
    const tintValue = getComputedStyle(card).getPropertyValue('--reader-landed-tint')
    expect(getComputedStyle(card).backgroundImage).toBe(
      `linear-gradient(${tintValue}, ${tintValue})`,
    )
    const peak = paintedPixel(cardBackground, tintValue)
    // default-dark's landedTintShare, 22%, of --selection-bg #1e3a8a
    // over its --bg-sunken #08090a is #0d1426.
    const expectedPeak = [13, 20, 38]
    expectedPeak.forEach((channel, i) => expect(Math.abs(peak[i] - channel)).toBeLessThanOrEqual(1))
    const rest = paintedPixel(cardBackground)
    tint.currentTime = 750
    const half = paintedPixel(
      getComputedStyle(card).backgroundColor,
      getComputedStyle(card).getPropertyValue('--reader-landed-tint'),
    )
    expect(half[2]).toBeGreaterThan(rest[2])
    expect(half[2]).toBeLessThan(peak[2])
    expect(document.querySelectorAll('[data-landed]')).toHaveLength(1)
    await waitFor(() => expect(row).not.toHaveAttribute('data-landed'), { timeout: 4_000 })
    expect(getComputedStyle(card).animationName).toBe('none')
    expect(getComputedStyle(card).backgroundImage).toBe('none')
    expect(getComputedStyle(card).backgroundColor).toBe(cardBackground)
  },
}

/** On native `rows` and the call cross apart, so the target waits for the commit bringing it. */
export const JumpHoldsUntilRowsBringTheRow: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    const before = scroller.scrollTop
    press('Jump')
    await outlastLanding()
    expect(scroller.scrollTop).toBe(before)
    press('Load all rows')
    await landedOn(JUMP_TARGET, scroller)
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** Late layout above the target must not leave it short: the loop re-asserts until height holds. */
export const JumpReassertsThroughLateLayout: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await frames(6)
    press('Grow above target')
    await frames(3)
    await landedOn(JUMP_TARGET, scroller)
  },
}

/**
 * A boundary load landing mid-jump starts the anchor hold, on a row that isn't the target. Left
 * running, it would undo each write as the two loops fought; landing wins and cancels it.
 */
export const JumpBeatsBoundaryLoad: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS.slice(1), hasOlder: true },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    press('Prepend and grow')
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** The other order: a hold already running when a jump arrives, on a row that isn't the target. */
export const JumpBeatsARunningHold: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS.slice(1), hasOlder: true },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Prepend and grow')
    await nextFrame()
    press('Jump')
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** With no jump in play a commit leaves the anchor hold running, or late layout would slip past. */
export const HoldSurvivesWithoutAJump: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS.slice(1), hasOlder: true },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Prepend and grow')
    await nextFrame()
    const before = topOffset('o2', scroller)
    entryRow('o1').style.paddingBottom = '300px'
    await outlastLanding()
    expect(Math.abs(topOffset('o2', scroller) - before)).toBeLessThan(1.5)
  },
}

/**
 * An empty near-top load flips `hasOlder` alone, so the skeleton's unmount starts a hold with no
 * `rows` commit to go with it. The growth is a style, as a `rows` commit would hide the gap.
 */
export const JumpBeatsAHasOlderFlip: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS, hasOlder: true },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    press('Prove branch top')
    await nextFrame()
    entryRow('o2').style.paddingBottom = '300px'
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** A row too near the tail to reach the top stops at the bottom, and the loop still ends. */
export const JumpToTailRowStopsAtBottom: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    press('Jump to tail')
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
    await outlastLanding()
    expect(topOffset('o14', scroller)).toBeGreaterThan(LANDING_GAP_PX + 100)
    press('Grow above target')
    await outlastLanding()
    expect(distanceFromBottom(scroller)).toBeGreaterThan(100)
  },
}

/** reader-composer.md → Autoscroll: a jump disengages, so the next chunk leaves the view alone. */
export const StreamGrowingBelowJumpHolds: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Next chunk')
    await frames(2)
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    const distance = distanceFromBottom(scroller)
    for (let i = 0; i < 3; i++) {
      press('Next chunk')
      await frames(2)
    }
    await landedOn(JUMP_TARGET, scroller)
    expect(distanceFromBottom(scroller)).toBeGreaterThan(distance)
  },
}

export const JumpBrokenByWheelUp = landingBrokenBy(LANDING_BREAKERS.wheelUp!)
export const JumpBrokenByWheelDown = landingBrokenBy(LANDING_BREAKERS.wheelDown!)
export const JumpBrokenByTouchDrag = landingBrokenBy(LANDING_BREAKERS.touchDrag!)
export const JumpBrokenByScrollbarPress = landingBrokenBy(LANDING_BREAKERS.scrollbarPress!)

/** A short reader still reserves the gutter, but a press there is no scrollbar press. */
export const GutterPressOnAShortReaderKeepsAutoscroll: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS.slice(0, 2) },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Next chunk')
    await frames(2)
    expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight)
    pressScrollbar(scroller)
    for (let i = 0; i < 30; i++) {
      press('Next chunk')
      await nextFrame()
    }
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1))
  },
}
export const JumpBrokenByUpwardKey = landingBrokenBy(LANDING_BREAKERS.upwardKey!)

/** A landing sits mid-document, where a downward key still moves the view: the loop lets it go. */
export const JumpBrokenByDownwardKey: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await frames(3)
    // A dispatched key scrolls nothing, so the play makes the move the key would.
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    scroller.scrollTop += 200
    const scrollTop = scroller.scrollTop
    await outlastLanding()
    expect(scroller.scrollTop).toBe(scrollTop)
  },
}

/** A plain Space typed into a field in the reader moves its caret, so the landing keeps going. */
export const JumpSurvivesASpaceTypedInAField: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const field = document.createElement('textarea')
    field.style.position = 'absolute'
    entryRow('o5').append(field)
    press('Jump')
    await frames(3)
    field.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    press('Grow above target')
    await frames(3)
    await landedOn(JUMP_TARGET, scroller)
  },
}

// Rich entries render into a shadow root, so a key from inside reaches the reader retargeted.
const RICH_CONTROLS_HTML = [
  '<style>@media (min-width: 1px) { p { margin: 0 } }</style>',
  '<details><summary>Notes</summary><p>The east wing again.</p></details>',
  '<textarea aria-label="Margin note"></textarea>',
].join('\n')

/** Space activates a summary and types into a field, inside rich content too: neither scrolls. */
export const JumpSurvivesASpaceOnAControlInRichContent: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: {
    rows: OVERFLOW_ROWS.map((row) =>
      row.id === 'o5' ? { ...row, content: RICH_CONTROLS_HTML } : row,
    ),
  },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const shadow = await waitFor(() => {
      const hosts = Array.from(entryRow('o5').querySelectorAll('div'))
      const root = hosts.find((host) => host.shadowRoot != null)?.shadowRoot
      if (root?.querySelector('summary') == null) throw new Error('rich content not mounted')
      return root
    })
    press('Jump')
    await frames(3)
    for (const control of ['summary', 'textarea']) {
      const el = shadow.querySelector<HTMLElement>(control)!
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, composed: true }))
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', shiftKey: true, bubbles: true, composed: true }),
      )
    }
    press('Grow above target')
    await frames(3)
    await landedOn(JUMP_TARGET, scroller)
  },
}

export const JumpBrokenByJumpToBottom: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    press('Bottom button')
    await waitFor(() => expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1), {
      timeout: 3_000,
    })
    await outlastLanding()
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
  },
}

/** No scroll write lands under a finger, and a press that never drags still lands on release. */
export const JumpWaitsOutARestingFinger: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  play: async ({ args }) => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const before = scroller.scrollTop
    scroller.dispatchEvent(new Event('touchstart', { bubbles: true }))
    press('Jump')
    await outlastLanding()
    expect(scroller.scrollTop).toBe(before)
    expect(args.onEntryLanded).not.toHaveBeenCalled()
    scroller.dispatchEvent(new Event('touchend', { bubbles: true }))
    await landedOn(JUMP_TARGET, scroller)
    await waitFor(() => expect(args.onEntryLanded).toHaveBeenCalledWith(JUMP_TARGET))
  },
}

// Chromium's compositor drops a fling once its scroller stops being user-scrollable, yet the
// fling's last delta, already in flight, still reaches the page a frame later (Fold-observed).
function flingUntilHalted(scroller: HTMLElement, onFrame: () => void, onHalted = () => {}) {
  const fling = { halted: false, foreignWrites: 0 }
  const ended = new Promise<void>((resolve) => {
    let left = scroller.scrollTop
    let frame = 0
    const stepPx = () => Math.max(2, Math.round(40 * 0.93 ** frame))
    const move = () => {
      if (Math.abs(scroller.scrollTop - left) >= 1) fling.foreignWrites += 1
      scroller.scrollTop -= stepPx()
      left = scroller.scrollTop
    }
    const step = () => {
      if (frame === 40) {
        resolve()
        return
      }
      if (getComputedStyle(scroller).overflowY === 'hidden') {
        fling.halted = true
        onHalted()
        requestAnimationFrame(() => {
          move()
          resolve()
        })
        return
      }
      onFrame()
      move()
      frame += 1
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  return { fling, ended }
}

/**
 * A fling's momentum scrolls on with no finger down, and a write mid-fling doesn't stop it: an
 * explicit jump halts the fling and lands at once, writing nothing while the fling still runs.
 */
export const JumpHaltsMomentum: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    let highlightedMidFling = false
    const { fling, ended } = flingUntilHalted(scroller, () => {
      if (entryRow(JUMP_TARGET).hasAttribute('data-landed')) highlightedMidFling = true
    })
    await frames(5)
    press('Jump')
    let landedAt = -1
    for (let frame = 1; frame <= 8 && landedAt < 0; frame++) {
      await nextFrame()
      if (Math.abs(topOffset(JUMP_TARGET, scroller) - LANDING_GAP_PX) < 1.5) landedAt = frame
    }
    await ended
    expect(fling.halted).toBe(true)
    expect(fling.foreignWrites).toBe(0)
    expect(highlightedMidFling).toBe(false)
    expect(landedAt).toBeGreaterThan(0)
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
    await waitFor(() => expect(entryRow(JUMP_TARGET)).toHaveAttribute('data-landed'))
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

// The reader reads a wheel's own time, so the chain sets it: frame spacing in a slow run can't
// break it, and a gap is exactly as long as a story makes it.
function wheelAt(scroller: HTMLElement, deltaY: number, timeStamp: number) {
  const event = new WheelEvent('wheel', { deltaY, bubbles: true })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  scroller.dispatchEvent(event)
}

const WHEEL_EVENT_SPACING_MS = 16

// Momentum is wheel events a frame apart; a dispatched wheel scrolls nothing, so each frame also
// moves the scroller, unless hidden (no wheel scrolls it). `startAt` is the first event's time.
function wheelChain(
  scroller: HTMLElement,
  length: number,
  stepPx: number,
  onFrame: () => void,
  startAt = performance.now(),
) {
  // `dispatchedAt` is the clock the reader judges the chain by: when its last wheel was handled.
  const chain = { foreignWrites: 0, hidden: false, lastAt: startAt, dispatchedAt: -1 }
  const ended = new Promise<void>((resolve) => {
    let left = scroller.scrollTop
    let frame = 0
    const step = () => {
      if (frame === length) {
        resolve()
        return
      }
      if (Math.abs(scroller.scrollTop - left) >= 1) chain.foreignWrites += 1
      const hidden = getComputedStyle(scroller).overflowY === 'hidden'
      if (hidden) chain.hidden = true
      onFrame()
      chain.lastAt = startAt + frame * WHEEL_EVENT_SPACING_MS
      chain.dispatchedAt = performance.now()
      wheelAt(scroller, stepPx, chain.lastAt)
      if (!hidden) scroller.scrollTop += stepPx
      left = scroller.scrollTop
      frame += 1
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  return { chain, ended }
}

/** A gesture dropping the landing between the halt and its restore leaves the reader scrollable. */
export const JumpDroppedMidHaltRestoresOverflow: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const { fling, ended } = flingUntilHalted(
      scroller,
      () => {},
      () => LANDING_BREAKERS.wheelUp!(scroller),
    )
    await frames(5)
    press('Jump')
    await ended
    expect(fling.halted).toBe(true)
    await outlastLanding()
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
  },
}

// Momentum runs on as wheel events after the press. The landing holds overflow hidden while the
// chain lasts, so it lands at once and the rest of the chain moves nothing.
async function jumpMidWheelChain(startAt?: number) {
  const scroller = scrollerOf('o1')
  await settleLanding(scroller)
  let jumped = false
  let unheldFrames = 0
  const { ended } = wheelChain(
    scroller,
    30,
    -20,
    () => {
      if (jumped && getComputedStyle(scroller).overflowY !== 'hidden') unheldFrames += 1
    },
    startAt,
  )
  await frames(5)
  jumped = true
  press('Jump')
  let landedAt = -1
  let highlighted = false
  for (let frame = 1; frame <= 8 && !(landedAt > 0 && highlighted); frame++) {
    await nextFrame()
    if (landedAt < 0 && Math.abs(topOffset(JUMP_TARGET, scroller) - LANDING_GAP_PX) < 1.5)
      landedAt = frame
    if (entryRow(JUMP_TARGET).hasAttribute('data-landed')) highlighted = true
  }
  await ended
  expect(landedAt).toBeGreaterThan(0)
  expect(unheldFrames).toBe(0)
  expect(highlighted).toBe(true)
  await landedOn(JUMP_TARGET, scroller)
  await outlastLanding()
  expect(getComputedStyle(scroller).overflowY).toBe('auto')
  await landedOn(JUMP_TARGET, scroller)
}

export const JumpHaltsWheelMomentum: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: () => jumpMidWheelChain(),
}

/**
 * Events queued behind a long commit reach the page late, stamped with their own older times. The
 * chain is live while they keep arriving, so the hold lasts as long.
 */
export const JumpHaltsWheelMomentumQueuedBehindACommit: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: () => jumpMidWheelChain(performance.now() - 1_000),
}

/** A reload dropping the row mid-hold ends the loop, and gives the reader its scrolling back. */
export const JumpRowDroppedMidWheelHoldRestoresOverflow: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const { ended } = wheelChain(scroller, 10, -20, () => {})
    await frames(5)
    press('Jump')
    await frames(3)
    expect(getComputedStyle(scroller).overflowY).toBe('hidden')
    press('Drop target')
    await ended
    await outlastLanding()
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
  },
}

/**
 * A chain that outlasts any momentum is the user's own scrolling, through the press: the hold lets
 * go about 3 s after it began, ends the landing, and the chain scrolls the reader again.
 */
export const JumpReleasesAWheelHoldAfterItsBound: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    // Registered before the press, so each frame's wheel arrives before the landing reads it, as
    // real input does; a play awaiting a frame would hand it a wheel a frame old.
    const hold = { pressedAt: -1, releasedAfterMs: -1, movedAfterRelease: -1, stopped: false }
    const ended = new Promise<void>((resolve) => {
      let at = performance.now()
      let releasedTop = 0
      let framesSinceRelease = 0
      const step = () => {
        if (hold.stopped) {
          resolve()
          return
        }
        const hidden = getComputedStyle(scroller).overflowY === 'hidden'
        if (hold.pressedAt >= 0 && hold.releasedAfterMs < 0 && !hidden) {
          hold.releasedAfterMs = performance.now() - hold.pressedAt
          releasedTop = scroller.scrollTop
        }
        at += WHEEL_EVENT_SPACING_MS
        wheelAt(scroller, 20, at)
        if (!hidden) scroller.scrollTop += 20
        if (hold.releasedAfterMs >= 0 && ++framesSinceRelease === 20) {
          hold.movedAfterRelease = scroller.scrollTop - releasedTop
          hold.stopped = true
        }
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    await frames(5)
    press('Jump')
    hold.pressedAt = performance.now()
    await Promise.race([ended, new Promise((resolve) => setTimeout(resolve, 6_000))])
    hold.stopped = true
    expect(hold.releasedAfterMs).toBeGreaterThanOrEqual(3_000)
    expect(hold.releasedAfterMs).toBeLessThan(4_000)
    expect(hold.movedAfterRelease).toBeGreaterThanOrEqual(20 * 20 - 1)
  },
}

/** Momentum never reverses: a wheel the other way is a new gesture, and drops the landing. */
export const JumpDroppedByAWheelReversingTheChain: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const { chain, ended } = wheelChain(scroller, 10, -20, () => {})
    await frames(5)
    press('Jump')
    await ended
    expect(getComputedStyle(scroller).overflowY).toBe('hidden')
    wheelAt(scroller, 20, chain.lastAt + WHEEL_EVENT_SPACING_MS)
    await nextFrame()
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
  },
}

// The surface's chain gap: a wheel handled longer ago than this ends the chain.
const WHEEL_CHAIN_GAP_MS = 100

/**
 * A target still waiting for its row holds nothing; the hold starts once the row arrives, in the
 * commit bringing it. A commit outlasting the chain's gap reads as the chain's end, so the hold
 * starts a frame later.
 */
export const JumpPendingHaltsWheelMomentumOnceItsRowArrives: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    const rowArrived = () => document.querySelector(`[data-entry-row="${JUMP_TARGET}"]`) != null
    let hiddenBeforeRow = false
    let unheldAfterRow = 0
    const { chain, ended } = wheelChain(scroller, 30, -20, () => {
      const hidden = getComputedStyle(scroller).overflowY === 'hidden'
      if (!rowArrived() && hidden) hiddenBeforeRow = true
      if (rowArrived() && !hidden) unheldAfterRow += 1
    })
    await frames(5)
    press('Jump')
    await frames(5)
    press('Load all rows')
    // React commits a click's update in a microtask, ahead of this one.
    await Promise.resolve()
    expect(rowArrived()).toBe(true)
    // Measured from before the wheel's dispatch, so never shorter than the gap the reader read.
    const commitOutlastedChain = performance.now() - chain.dispatchedAt >= WHEEL_CHAIN_GAP_MS
    let landedAt = -1
    for (let frame = 1; frame <= 6 && landedAt < 0; frame++) {
      await nextFrame()
      if (Math.abs(topOffset(JUMP_TARGET, scroller) - LANDING_GAP_PX) < 1.5) landedAt = frame
    }
    await ended
    expect(hiddenBeforeRow).toBe(false)
    expect(landedAt).toBeGreaterThan(0)
    expect(unheldAfterRow).toBeLessThanOrEqual(commitOutlastedChain ? 1 : 0)
    await outlastLanding()
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** A wheel after a gap drops a landing holding a chain, and gives the reader its scrolling back. */
export const JumpDroppedMidWheelHoldRestoresOverflow: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const { chain, ended } = wheelChain(scroller, 10, -20, () => {})
    await frames(5)
    press('Jump')
    await ended
    expect(getComputedStyle(scroller).overflowY).toBe('hidden')
    wheelAt(scroller, -20, chain.lastAt + 150)
    await nextFrame()
    expect(getComputedStyle(scroller).overflowY).toBe('auto')
  },
}

/** A wheel after a gap in the chain is a new gesture, and drops the jump as any wheel would. */
export const JumpPendingDroppedByWheelAfterAGap: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    const { chain, ended } = wheelChain(scroller, 10, -20, () => {})
    await frames(5)
    press('Jump')
    await ended
    wheelAt(scroller, -20, chain.lastAt + 150)
    press('Load all rows')
    await outlastLanding()
    expect(entryRow(JUMP_TARGET)).not.toHaveAttribute('data-landed')
    expect(topOffset(JUMP_TARGET, scroller)).not.toBeCloseTo(LANDING_GAP_PX, 0)
  },
}

/** The reader's own one-off write moves the scroll for a frame, which is no fling to halt. */
export const JumpLeavesOverflowAloneOnAOneOffWrite: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS.slice(1), hasOlder: true },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    const overflows: string[] = []
    const observer = new MutationObserver(() => overflows.push(scroller.style.overflowY))
    observer.observe(scroller, { attributes: true, attributeFilter: ['style'] })
    press('Prepend and grow')
    await outlastLanding()
    observer.disconnect()
    expect(overflows).not.toContain('hidden')
    await landedOn(JUMP_TARGET, scroller)
  },
}

/**
 * A frame the loop had to correct isn't a settled one, or it would stop following a row that still
 * moves. Padding shifts from below the row to above it, so the scroll height never changes.
 */
export const JumpFollowsARowStillMoving: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    entryRow('o2').style.paddingBottom = '0px'
    entryRow('o5').style.paddingBottom = '200px'
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    const height = scroller.scrollHeight
    for (let shifted = 5; shifted <= 200; shifted += 5) {
      entryRow('o2').style.paddingBottom = `${shifted}px`
      entryRow('o5').style.paddingBottom = `${200 - shifted}px`
      await nextFrame()
    }
    expect(scroller.scrollHeight).toBe(height)
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/**
 * Pins the landing's final position while the open-at-bottom pin is still running. The landing's
 * stopBottomPin() is defence in depth: the pin's frame callback runs first, so no story isolates it.
 */
export const JumpCancelsTheBottomPin: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    press('Jump')
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
  },
}

/**
 * Jump to bottom opens a 500 ms window that reads as at-bottom. A stream starting inside it, once
 * the landing has settled, gets no scroll event to correct that, so a jump has to close it.
 */
export const JumpClearsTheBottomSettle: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Bottom button')
    press('Jump')
    await frames(12)
    press('Next chunk')
    await frames(2)
    press('Next chunk')
    await frames(2)
    await landedOn(JUMP_TARGET, scroller)
  },
}

/** Landing inside the at-bottom band still disengages, or the next chunk would re-pin the view. */
export const StreamGrowingBelowTailJumpHolds: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Next chunk')
    await frames(2)
    press('Jump to tail')
    await outlastLanding()
    const top = scroller.scrollTop
    press('Next chunk')
    await frames(2)
    press('Next chunk')
    await frames(2)
    expect(scroller.scrollTop).toBe(top)
  },
}

/** A stream starting on the jump's own tick still leaves the view on the target. */
export const StreamStartingOnAJumpHolds: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    press('Next chunk')
    await outlastLanding()
    await landedOn(JUMP_TARGET, scroller)
    press('Next chunk')
    await frames(3)
    await landedOn(JUMP_TARGET, scroller)
  },
}

/**
 * A landing waits a frame for scroll rest. A stream starting inside that wait must not keep
 * autoscroll engaged: its write on every chunk would read as movement and keep the landing waiting.
 */
export const StreamChunkingEveryFrameOnAJumpHolds: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    let highlighted = false
    for (let i = 0; i < 60; i++) {
      press('Next chunk')
      await nextFrame()
      if (entryRow(JUMP_TARGET).hasAttribute('data-landed')) highlighted = true
    }
    expect(Math.abs(topOffset(JUMP_TARGET, scroller) - LANDING_GAP_PX)).toBeLessThan(1.5)
    expect(highlighted).toBe(true)
  },
}

/**
 * A fling that outlives its halt is waited out. Should it carry the reader into the at-bottom band,
 * the band must not re-engage autoscroll: its write on every chunk would keep the landing waiting.
 */
export const StreamChunkingAfterAFlingOutlivesItsHaltHolds: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Next chunk')
    await frames(2)
    await scrollToDistance(scroller, 400)
    const flingEnded = new Promise<void>((resolve) => {
      let frame = 0
      const step = () => {
        if (frame === 24) {
          resolve()
          return
        }
        scroller.scrollTop += 15
        frame += 1
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    })
    await frames(5)
    press('Jump')
    await flingEnded
    expect(distanceFromBottom(scroller)).toBeLessThan(80)
    let landed = false
    let highlighted = false
    // One quiet frame reads as rest and the next writes; the rest is margin for callback order.
    for (let i = 0; i < 6 && !landed; i++) {
      press('Next chunk')
      await nextFrame()
      landed = Math.abs(topOffset(JUMP_TARGET, scroller) - LANDING_GAP_PX) < 1.5
      if (entryRow(JUMP_TARGET).hasAttribute('data-landed')) highlighted = true
    }
    expect(landed).toBe(true)
    expect(highlighted).toBe(true)
  },
}

/** A newer jump replaces a target still waiting for its row. */
export const JumpReplacesAPendingTarget: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Jump')
    await nextFrame()
    press('Jump to tail')
    await outlastLanding()
    press('Load all rows')
    await waitFor(() => expect(entryRow(JUMP_TARGET)).toBeInstanceOf(HTMLElement))
    await outlastLanding()
    expect(entryRow(JUMP_TARGET)).not.toHaveAttribute('data-landed')
    expect(entryRow('o14')).toHaveAttribute('data-landed')
  },
}

/** A gesture before the row arrives drops the target too: the commit must not yank the view. */
export const JumpPendingDroppedByWheel: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Jump')
    await nextFrame()
    LANDING_BREAKERS.wheelUp!(scroller)
    press('Load all rows')
    await outlastLanding()
    expect(entryRow(JUMP_TARGET)).not.toHaveAttribute('data-landed')
    expect(topOffset(JUMP_TARGET, scroller)).not.toBeCloseTo(LANDING_GAP_PX, 0)
  },
}

/** A branch switch drops a pending target even when the new branch holds that id. */
export const JumpPendingDroppedByBranchChange: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: PARTIAL_ROWS },
  play: async () => {
    const scroller = scrollerOf('o14')
    await settleLanding(scroller)
    press('Jump')
    await nextFrame()
    press('Switch branch')
    await waitFor(() => expect(entryRow(JUMP_TARGET)).toBeInstanceOf(HTMLElement))
    await outlastLanding()
    expect(entryRow(JUMP_TARGET)).not.toHaveAttribute('data-landed')
    expect(distanceFromBottom(scroller)).toBeLessThanOrEqual(1)
  },
}

/** A branch switch clears the highlight of a row that already landed. */
export const JumpHighlightClearedByBranchChange: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    press('Switch branch')
    await waitFor(() => expect(document.querySelector('[data-landed]')).toBeNull())
  },
}

/** A row a reload drops mid-landing ends the loop rather than reading a detached rect. */
export const JumpEndsWhenTheRowLeaves: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    press('Jump')
    await nextFrame()
    press('Drop target')
    await nextFrame()
    const top = scroller.scrollTop
    await outlastLanding()
    expect(scroller.scrollTop).toBe(top)
  },
}

/**
 * A reader under another screen has no layout: the loop waits it out and lands once it has one.
 * The fade's clock waits with it, so the highlight can't run out on a row off screen.
 */
export const JumpWaitsOutAHiddenReader: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: { rows: OVERFLOW_ROWS, onEntryLanded: fn(async () => {}) },
  play: async ({ args }) => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const box = scroller.parentElement
    if (box == null) throw new Error('no reader box')
    box.style.display = 'none'
    press('Jump')
    await outlastLanding()
    expect(document.querySelector('[data-landed]')).toBeNull()
    expect(args.onEntryLanded).not.toHaveBeenCalled()
    box.style.display = ''
    await landedOn(JUMP_TARGET, scroller)
    await waitFor(() => expect(entryRow(JUMP_TARGET)).toHaveAttribute('data-landed'))
    await waitFor(() => expect(args.onEntryLanded).toHaveBeenCalledWith(JUMP_TARGET))
  },
}

/** The highlight is an attribute on the wrapper, so no row re-renders for it. */
export const JumpHighlightSkipsTheRowMemo: Story = {
  render: (args) => <JumpHarness {...args} />,
  args: {
    rows: OVERFLOW_ROWS.map((row) => {
      const counted = { ...row }
      Object.defineProperty(counted, 'content', {
        enumerable: true,
        get: () => {
          contentReads.count += 1
          return row.content
        },
      })
      return counted
    }),
  },
  play: async () => {
    const scroller = scrollerOf('o1')
    await settleLanding(scroller)
    const before = contentReads.count
    expect(before).toBeGreaterThan(0)
    press('Jump')
    await landedOn(JUMP_TARGET, scroller)
    await waitFor(() => expect(entryRow(JUMP_TARGET)).toHaveAttribute('data-landed'))
    await nextFrame()
    expect(contentReads.count).toBe(before)
  },
}
