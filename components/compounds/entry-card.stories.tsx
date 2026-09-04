import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState, type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import { themes } from '@/lib/themes'

import { EntryCard, type EntryCardProps } from './entry-card'

const baseProps = {
  // Host-resolved in the reader; stories state it outright. The two phone-fork stories
  // override it alongside the viewport global they also set.
  tier: 'desktop' as const,
  worldTimeLabel: 'Day 12 · 14:33',
  onEdit: fn(),
  onDelete: fn(),
  onRegen: fn(),
  onBranch: fn(),
  onFlipEra: fn(),
}

const aiMeta = {
  tokens: { prompt: 1840, completion: 312, reasoning: 87 },
}

// Module scope keeps the frame referentially stable — WorldTimeEditForm's
// tuple memo keys on its identity.
const ORIGIN = { year: 2024, month: 1, day: 1, hour: 0, minute: 0, second: 0 }

// 90 s past the origin — 00:01:30, so the `second` tier seeds at 30.
const editableTimeProps = {
  worldTimeRaw: 90,
  worldTimeFrame: { calendar: EARTH_GREGORIAN, origin: ORIGIN },
}

const aiEntry = {
  kind: 'ai_reply',
  content: 'The figure raises a single gloved hand.',
  meta: aiMeta,
} satisfies Partial<EntryCardProps>

// The clickable footer is found by its aria-label, so nothing else notices if
// the label degrades to a bare string on the trigger — which would silently
// drop the muted text style, since bare strings ignore TextClassContext.
function expectLabelIsOwnTextNode() {
  const label = screen.getByText(baseProps.worldTimeLabel)
  const trigger = screen.getByRole('button', { name: 'Edit time' })
  expect(label).toBeVisible()
  expect(trigger).toContainElement(label)
  expect(label).not.toBe(trigger)
}

const meta: Meta<typeof EntryCard> = {
  title: 'Compounds/EntryCard',
  component: EntryCard,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type StoryT = StoryObj<typeof EntryCard>

const wrapDecorator = (Story: () => ReactElement) => (
  <View style={{ width: 600 }}>
    <Story />
  </View>
)
const wrap = { decorators: [wrapDecorator] } satisfies Partial<StoryT>

export const UserKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user_action',
    content: 'I draw my sword and step toward the figure in the doorway, ready to strike.',
  },
}

export const AiKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content:
      'The figure raises a single gloved hand and the air thickens around your blade — you feel the metal hum, then go still in your grip, suddenly heavier than it should be.',
    meta: aiMeta,
    reasoning:
      'The user is being aggressive but the figure is meant to read as a warden — let me lean on supernatural restraint rather than a fight scene. Use kinesthetic detail (sword going still) to telegraph "you cannot win this without thinking".',
  },
}

export const AiNoReasoning: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: 'The figure tilts its head, and the air thickens around your blade.',
    meta: { tokens: { prompt: 1290, completion: 145 } },
  },
}

export const OpeningKind: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    onDelete: undefined, // opening cannot be deleted
    kind: 'opening',
    content:
      'The road from Ironshore is empty for a hundred miles. You have ridden three days; the warden waits at the next bend.',
    meta: { tokens: { prompt: 1120, completion: 89 } },
  },
}

export const SystemKind: StoryT = {
  ...wrap,
  args: {
    kind: 'system',
    content: 'Generation failed: provider returned 503.',
    detail: 'The model service is temporarily unavailable. Retry in a moment.',
    onRetry: fn(),
    onDismiss: fn(),
  },
}

export const StreamingPending: StoryT = {
  ...wrap,
  args: {
    kind: 'streaming',
    streamingPhase: 'reply',
    content: '',
  },
}

export const StreamingReasoning: StoryT = {
  ...wrap,
  args: {
    kind: 'streaming',
    streamingPhase: 'reasoning',
    content: '',
    reasoning: 'Thinking about how the warden would respond to direct aggression…',
  },
  // The toggle is the only control this state renders, so its absence is the
  // whole "card body is blank" symptom.
  play: async () => {
    expect(await screen.findByRole('button', { name: 'Show reasoning' })).toBeInTheDocument()
    // parseFloat not Number: Number('') is 0, which passes with no animation at
    // all. This pins that the pulse animates, NOT the deps array — the freeze an
    // empty deps array causes is environment-dependent and does not reproduce
    // under the browser test project, where the mutation survives.
    const pulsing = screen.getByTestId('reasoning-pulse')
    await waitFor(() => expect(parseFloat(pulsing.style.opacity)).toBeLessThan(0.9))
  },
}

export const StreamingReply: StoryT = {
  ...wrap,
  args: {
    kind: 'streaming',
    streamingPhase: 'reply',
    reasoning: 'Thought about how the warden would respond to direct aggression.',
    content: 'The figure raises a single gloved hand and the air thickens around your bla',
  },
}

export const EditMode: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user_action',
    content: 'I draw my sword and step toward the figure in the doorway.',
    editing: true,
    onContentChange: fn(),
    onCommitEdit: fn(),
    onCancelEdit: fn(),
  },
}

/** The head turn's action: the reply below it answers text that is being rewritten. */
export const EditModeWithRegen: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user_action',
    content: 'I draw my sword and step toward the figure in the doorway.',
    editing: true,
    onContentChange: fn(),
    onCommitEdit: fn(),
    onCommitEditAndRegen: fn(),
    onCancelEdit: fn(),
  },
}

/**
 * The gate is held: the row's controls refuse, the prose does not change
 * shade. Reading is never gated (principles.md → What's not gated), and the
 * streaming card renders without `disabled` — a dim here would make the text
 * shift the frame a turn commits and shift back when it settles.
 */
export const Disabled: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
    disabled: true,
    disabledReason: 'Generation is in flight. Cancel to edit.',
  },
}

export const NoWorldTime: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    worldTimeLabel: undefined,
    kind: 'ai_reply',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
  },
}

export const NoFlipEra: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    onFlipEra: undefined,
    kind: 'ai_reply',
    content: 'The figure raises a single gloved hand.',
    meta: aiMeta,
  },
}

export const ReasoningTogglesOnBrainClick: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: 'The figure raises a hand.',
    meta: aiMeta,
    reasoning: 'Lean on restraint, not combat.',
  },
  play: async () => {
    const brain = screen.getByRole('button', { name: 'Show reasoning' })
    // Reasoning hidden initially.
    expect(screen.queryByText('Lean on restraint, not combat.')).not.toBeInTheDocument()
    await userEvent.click(brain)
    await waitFor(() =>
      expect(screen.getByText('Lean on restraint, not combat.')).toBeInTheDocument(),
    )
    // Toggle back.
    const closer = screen.getByRole('button', { name: 'Hide reasoning' })
    await userEvent.click(closer)
    await waitFor(() =>
      expect(screen.queryByText('Lean on restraint, not combat.')).not.toBeInTheDocument(),
    )
  },
}

// Nothing between the narrative island and the reader's scroller clips
// overflow, so anything that refuses to wrap escapes the card and gives that
// scroller a horizontal axis. scrollWidth reports overflowing content even
// under overflow: visible, which is what makes the leak measurable here.
async function expectReasoningStaysInsideCard(canvasElement: HTMLElement) {
  await userEvent.click(screen.getByRole('button', { name: 'Show reasoning' }))
  const island = await waitFor(() => {
    const found = canvasElement.querySelector<HTMLElement>('.narrative-html')
    expect(found).not.toBeNull()
    return found as HTMLElement
  })
  expect(island.scrollWidth).toBeLessThanOrEqual(island.clientWidth)
}

/**
 * Reasoning streams arrive indented, which `marked` reads as an indented code
 * block — and `<pre>` defaults to `white-space: pre`, which suppresses line
 * breaking outright.
 */
export const ReasoningIndentedBlockWraps: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: 'The floorboards were cool beneath her bare feet.',
    meta: aiMeta,
    reasoning: `Maya [c1].
Write the next beat as prose. Do not break character or address the reader.

    *   *Current state:* Maya is moving from her bedroom to the kitchen.
    *   *Goal:* Expand on the sensory details of the walk and her arrival in the kitchen, maintaining the established "mundane" and "safe" tone, while potentially hinting at something.
`,
  },
  play: async ({ canvasElement }) => {
    await expectReasoningStaysInsideCard(canvasElement)
  },
}

/**
 * The second escape route, independent of the code-block one: an unbroken run
 * of characters has no break opportunity for normal wrapping to take.
 */
export const ReasoningLongTokenWraps: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: 'The floorboards were cool beneath her bare feet.',
    meta: aiMeta,
    reasoning: `Considering the retrieval key ${'x'.repeat(400)} before drafting.`,
  },
  play: async ({ canvasElement }) => {
    await expectReasoningStaysInsideCard(canvasElement)
  },
}

export const SystemRetryFires: StoryT = {
  ...wrap,
  args: {
    kind: 'system',
    tier: 'desktop',
    content: 'Generation failed.',
    onRetry: fn(),
    onDismiss: fn(),
  } satisfies EntryCardProps,
  play: async ({ args }) => {
    const retry = screen.getByRole('button', { name: /Retry/ })
    await userEvent.click(retry)
    await waitFor(() => expect(args.onRetry).toHaveBeenCalledTimes(1))
  },
}

export const KindMatrix: StoryT = {
  parameters: { layout: 'padded' },
  render: () => (
    <View className="flex-col gap-4" style={{ maxWidth: 700 }}>
      <EntryCard
        tier="desktop"
        kind="opening"
        content="The road from Ironshore is empty for a hundred miles."
        worldTimeLabel="Day 1 · 06:00"
        meta={{ tokens: { prompt: 1120, completion: 89 } }}
        onEdit={fn()}
        onBranch={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        tier="desktop"
        kind="user_action"
        content="I keep riding."
        worldTimeLabel="Day 1 · 06:05"
        onEdit={fn()}
        onDelete={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        tier="desktop"
        kind="ai_reply"
        content="At the next bend, a figure in dust-grey waits."
        worldTimeLabel="Day 1 · 09:14"
        meta={aiMeta}
        reasoning="Setup the warden encounter."
        onEdit={fn()}
        onDelete={fn()}
        onRegen={fn()}
        onBranch={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        tier="desktop"
        kind="streaming"
        streamingPhase="reasoning"
        content=""
        reasoning="Working out the warden's first words…"
      />
      <EntryCard
        tier="desktop"
        kind="system"
        content="Provider returned 503."
        detail="Model service temporarily unavailable."
        onRetry={fn()}
        onDismiss={fn()}
      />
    </View>
  ),
}

export const ThemeMatrix: StoryT = {
  parameters: { layout: 'padded' },
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="overflow-hidden rounded-md border border-border bg-bg-base p-3"
        >
          <View className="pb-2">
            <Text variant="muted" size="xs">
              {t.name}
            </Text>
          </View>
          <View className="flex-col gap-3">
            <EntryCard
              tier="desktop"
              kind="user_action"
              content="I keep riding."
              worldTimeLabel="Day 1 · 06:05"
              onEdit={fn()}
              onDelete={fn()}
            />
            <EntryCard
              tier="desktop"
              kind="ai_reply"
              content="At the next bend, a figure in dust-grey waits."
              worldTimeLabel="Day 1 · 09:14"
              meta={aiMeta}
              onEdit={fn()}
              onDelete={fn()}
              onRegen={fn()}
              onBranch={fn()}
            />
          </View>
        </View>
      ))}
    </View>
  ),
}

export const MarkdownRendering: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content:
      '## Storm break\n\nThe watchmen scatter. **Sable** notices, *quietly*:\n\n- a torn cloak by the well\n- footprints heading inland\n\n```\nthree strikes, then silence\n```',
    meta: aiMeta,
  },
}

export const RichContent: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content: [
      'A styled scene card:',
      '',
      '<div style="background: linear-gradient(135deg, #1f2937, #4c1d95); padding: 12px; border-radius: 8px; color: #f9fafb">',
      '<style>@keyframes pulse { 50% { opacity: 0.5 } } .glow { animation: pulse 2s infinite }</style>',
      '<span class="glow">The beacon pulses.</span>',
      '</div>',
      '',
      '| Name | Role |',
      '| ---- | ---- |',
      '| Ana  | Scout |',
    ].join('\n'),
    meta: aiMeta,
  },
}

export const XssSanitizationAllowlist: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    // No <script> here: a script tag has no RNRH element model, so it flips
    // the entry to the rich path (shadow root) — RichXssSanitization covers
    // that. An onerror-bearing <img> keeps the entry on the plain path.
    content: 'Safe text. <img src=x onerror="window.__xss = true">',
    meta: aiMeta,
  },
  play: async () => {
    // window.__xss is only ever set by the payload's onerror executing —
    // its absence is the sanitization assertion.
    expect((globalThis as { __xss?: boolean }).__xss).toBeUndefined()
    await waitFor(() => expect(screen.getByText(/Safe text\./)).toBeInTheDocument())
  },
}

export const RichXssSanitization: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    content:
      'Safe rich text. <style>@keyframes x { to { opacity: 0.5 } }</style><script>window.__xssRich = true</script><img src=x onerror="window.__xssRich = true">',
    meta: aiMeta,
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      const host = Array.from(canvasElement.querySelectorAll('div')).find(
        (div) => div.shadowRoot != null,
      )
      expect(host).toBeDefined()
      expect(host!.shadowRoot!.innerHTML).toContain('Safe rich text.')
    })
    expect((globalThis as { __xssRich?: boolean }).__xssRich).toBeUndefined()
  },
}

/**
 * Desktop / tablet fork: the card anchors the edit form itself, and Cancel
 * closes it without reporting. Runs at the 1200 px default viewport, so
 * `onRequestEditTime` must stay untouched even though it is supplied.
 */
export const EditableWorldTimeFooter: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
    onRequestEditTime: fn(),
  },
  play: async ({ args, canvasElement }) => {
    // No break passed, so nothing may claim the indicator's role.
    expect(canvasElement.querySelector('[role="img"]')).toBeNull()
    expectLabelIsOwnTextNode()

    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())
    expect(args.onRequestEditTime).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(args.onEditTime).not.toHaveBeenCalled()
  },
}

/**
 * Phone fork. Both handlers are supplied, so `tier === 'phone'` is the only
 * path that reaches `onRequestEditTime` — the viewport global is what proves
 * it, and Storybook's vitest addon applies it before the story runs.
 */
export const WorldTimeEditRequestsHostOverlayOnPhone: StoryT = {
  ...wrap,
  globals: { viewport: { value: 'mobile1' } },
  args: {
    ...baseProps,
    tier: 'phone',
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
    onRequestEditTime: fn(),
  },
  play: async ({ args }) => {
    expectLabelIsOwnTextNode()
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(args.onRequestEditTime).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(args.onEditTime).not.toHaveBeenCalled()
  },
}

/**
 * Pins the fallback as contract, not accident: a host that supplies only an
 * inline editor gets the inline editor at every tier, phone included. The dev
 * screen and these stories are exactly such hosts, so this is not a misuse to
 * warn about — only a host that omits `onEditTime` asks for the native Sheet.
 */
export const WorldTimeInlineEditorOnPhone: StoryT = {
  ...wrap,
  globals: { viewport: { value: 'mobile1' } },
  args: {
    ...baseProps,
    tier: 'phone',
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))
  },
}

/** Editing the seed value and saving reports cumulative seconds, then closes. */
export const WorldTimeEditSaveReportsSeconds: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    // Re-query after each step: FormRow re-picks its layout one frame after the
    // dialog opens, which swaps the branch and detaches the earlier node.
    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    // 00:01:45 past the origin.
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/**
 * A host that reports the write failed keeps the overlay open on the typed
 * tuple, so the edit is not lost to a retype — the phone Sheet and the reader's
 * other edit flows behave the same way. Only `true` closes it; a rejected
 * promise is caught and reported rather than closing on a write that failed.
 */
export const WorldTimeEditKeepsOverlayOpenOnFailure: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => false),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))

    // Still open, still holding what was typed, and the failure is explained
    // in the same realm that owns the editor.
    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't update the entry's time.")
  },
}

/**
 * A rejecting host must not wedge Save. On native the card runs inside the
 * expo-dom WebView, where a bridge-level failure rejects outside the host's own
 * try/catch and no global handler exists — uncaught, the overlay would sit there
 * doing nothing on every retry.
 */
export const WorldTimeEditSurvivesARejectedWrite: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => {
      throw new Error('bridge closed')
    }),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))

    // A WebView-local error stays visible beside the form; a document-local
    // toast queue has no mounted consumer in the native reader.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent("Couldn't update the entry's time."),
    )

    // Overlay survives with the typed tuple, and Save still works on a retry.
    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledTimes(2))
  },
}

const pendingWorldTimeSave: { finish?: (ok: boolean) => void } = {}

/** A submitted editor cannot be dismissed and replaced before its save settles. */
export const WorldTimeEditLocksWhileSaving: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(
      () =>
        new Promise<boolean>((resolve) => {
          pendingWorldTimeSave.finish = resolve
        }),
    ),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))

    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()

    pendingWorldTimeSave.finish?.(true)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/**
 * Tier-independent half of the fork: with no `onEditTime` to land a save on,
 * the card refuses to host the overlay at any width, because a Dialog Save
 * would have nowhere to report and would discard the edit silently.
 */
export const WorldTimeEditRequestsHostOverlay: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onRequestEditTime: fn(),
  },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(args.onRequestEditTime).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  },
}

/** The break shows as a footer indicator and again as a banner inside the form. */
export const WorldTimeMonotonicityIndicator: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
    worldTimeMonotonicityBreak: { previousLabel: 'Day 12 · 14:33' },
  },
  play: async () => {
    const indicator = screen.getByLabelText('Earlier than previous entry (Day 12 · 14:33)')
    await expect(indicator).toBeVisible()
    // Canon requires hovering the indicator to surface the same string without
    // opening the overlay (patterns/entry-card.md → Click-to-edit).
    expect(indicator.parentElement).toHaveAttribute(
      'title',
      'Earlier than previous entry (Day 12 · 14:33)',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() =>
      expect(screen.getByText(/Earlier than previous entry \(Day 12 · 14:33\)/)).toBeVisible(),
    )
  },
}

/** In-flight gate: `disabled` makes the footer inert, no pointer-events juggling. */
export const WorldTimeFooterInertWhileDisabled: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
    onRequestEditTime: fn(),
    disabled: true,
    disabledReason: 'Generating…',
  },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'Edit time' })).not.toBeInTheDocument()
    await expect(screen.getByText('Day 12 · 14:33')).toBeVisible()
  },
}

/** An entry already open for content editing offers no second edit affordance. */
export const WorldTimeFooterInertWhileEditing: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
    onRequestEditTime: fn(),
    editing: true,
    onContentChange: fn(),
    onCommitEdit: fn(),
    onCancelEdit: fn(),
  },
  play: async () => {
    expect(screen.queryByRole('button', { name: 'Edit time' })).not.toBeInTheDocument()
    await expect(screen.getByText('Day 12 · 14:33')).toBeVisible()
  },
}

/**
 * A generation starting while the dialog is open drops the edit affordance and
 * unmounts the overlay. It must not come back on its own when generation ends:
 * the open flag lives inside the dialog subtree so it dies with it. Driven
 * through a harness rather than args because the resurrection only shows across
 * a `disabled` round-trip, and the setter is called directly because a modal
 * aria-hides every control outside itself.
 */
let setStoryBlocked: ((blocked: boolean) => void) | null = null

function ResurrectHarness(args: EntryCardProps) {
  const [blocked, setBlocked] = useState(false)
  useEffect(() => {
    setStoryBlocked = setBlocked
    return () => {
      setStoryBlocked = null
    }
  }, [])
  return <EntryCard {...args} disabled={blocked} />
}

export const WorldTimeEditDoesNotResurrectAfterGeneration: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...editableTimeProps,
    onEditTime: fn(async () => true),
  },
  render: (args) => <ResurrectHarness {...args} />,
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible())

    setStoryBlocked?.(true)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit time' })).not.toBeInTheDocument(),
    )

    setStoryBlocked?.(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit time' })).toBeVisible())
    expect(screen.queryByRole('dialog', { name: 'Edit time' })).not.toBeInTheDocument()
  },
}

// --- World-state panel -------------------------------------------------------

const CHAR_A = 'char_00000000-0000-4000-8000-0000000000a1'
const CHAR_B = 'char_00000000-0000-4000-8000-0000000000b2'
const ITEM_A = 'item_00000000-0000-4000-8000-0000000000c3'
const LOC_A = 'loc_00000000-0000-4000-8000-0000000000d4'
const LOC_B = 'loc_00000000-0000-4000-8000-0000000000e5'
const GONE = 'char_00000000-0000-4000-8000-0000000000f6'

// The resolution pool covers every id the panel may mention — a transfer's
// counterparty and a rejected location sit outside the scene.
const entityNames = [
  { id: CHAR_A, name: 'Aria' },
  { id: CHAR_B, name: 'Corin' },
  { id: ITEM_A, name: 'Sword of Dawn' },
  { id: LOC_A, name: 'Ashfen Marshes' },
  { id: LOC_B, name: 'Eldrin Keep' },
]

const sceneOptions = {
  characters: [
    { id: CHAR_A, name: 'Aria' },
    { id: CHAR_B, name: 'Corin' },
  ],
  items: [{ id: ITEM_A, name: 'Sword of Dawn' }],
  locations: [
    { id: LOC_A, name: 'Ashfen Marshes' },
    { id: LOC_B, name: 'Eldrin Keep' },
  ],
}

const reportedProps = {
  sceneEntities: [CHAR_A, CHAR_B],
  currentLocationId: LOC_A,
  entityNames,
  summary: 'Aria pushed into the marshes and met an exiled noble.',
  stateReport: {
    layer: 'piggyback_tagged_block' as const,
    sceneEntities: [CHAR_A, CHAR_B],
    currentLocation: LOC_A,
    worldTimeDelta: 120,
    visualChanges: [
      { id: CHAR_B, type: 'attire' as const, text: 'cloak now muddied to the waist' },
    ],
    transfers: {
      items: [{ id: ITEM_A, slot: 'inventory' as const, to: CHAR_A, from: CHAR_B }],
      stackables: [{ key: 'gold', amount: 50, to: CHAR_A, from: CHAR_B }],
    },
  },
} satisfies Partial<EntryCardProps>

async function openPanel() {
  await userEvent.click(screen.getByRole('button', { name: 'Show state' }))
  await waitFor(() => expect(screen.getByText('World state block')).toBeVisible())
}

export const WorldStateReported: StoryT = {
  ...wrap,
  args: { ...baseProps, ...aiEntry, ...reportedProps },
  play: async () => {
    await openPanel()
    expect(screen.getByText('piggyback')).toBeVisible()
    expect(screen.getByText('Ashfen Marshes')).toBeVisible()
    expect(screen.getByText('cloak now muddied to the waist')).toBeVisible()
    expect(screen.getByText('120s')).toBeVisible()
  },
}

export const WorldStateFallbackRecovered: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    sceneEntities: [CHAR_A],
    currentLocationId: LOC_A,
    entityNames,
    stateReport: {
      layer: 'per_turn_classifier',
      sceneEntities: [CHAR_A],
      failedFields: [{ field: 'transfers', detail: 'content present but no entries' }],
      raw: '<state>\n  <transfers>\n    <item id="i1"',
    },
  },
  play: async () => {
    await openPanel()
    // The whole of the invisible-fallback fix: before the badge, a fallback turn
    // wrote metadata and deltas but touched no content, so it was unobservable.
    expect(screen.getByText('classifier fallback')).toBeVisible()
    expect(screen.getByText('State not fully recorded: transfers.')).toBeVisible()
  },
}

export const WorldStateRejectedLocation: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    sceneEntities: [CHAR_A],
    currentLocationId: LOC_A,
    entityNames,
    // apply.ts refused the emitted id (an item, not a location) and inherited the
    // previous location. The flag is what the panel keys on — an emitted id merely
    // unequal to currentLocationId is a user scene edit, not a rejection.
    stateReport: {
      layer: 'piggyback_tagged_block',
      currentLocation: ITEM_A,
      currentLocationRejected: true,
    },
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText(/emitted id was not a location/)).toBeVisible()
  },
}

// The report is immutable provenance while currentLocationId is user-editable, so an
// emitted id unequal to the applied one is the ordinary post-edit state. Labelling it a
// rejection accuses the model of an error the user made deliberately.
export const WorldStateEditedLocation: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    sceneEntities: [CHAR_A],
    // The user moved the scene here after the turn landed on LOC_A.
    currentLocationId: LOC_B,
    entityNames,
    stateReport: { layer: 'piggyback_tagged_block', currentLocation: LOC_A },
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText('Eldrin Keep')).toBeVisible()
    expect(screen.queryByText(/emitted id was not a location/)).not.toBeInTheDocument()
  },
}

// A positive delta that apply.ts still truncated: the case `worldTimeDelta < 0` could
// never detect, since nothing about the emitted value alone reveals the headroom bound.
export const WorldStateHeadroomClampedDelta: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    sceneEntities: [CHAR_A],
    currentLocationId: LOC_A,
    entityNames,
    stateReport: {
      layer: 'piggyback_tagged_block',
      worldTimeDelta: 9_000_000,
      worldTimeDeltaApplied: 120,
    },
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText(/clamped to 120s/)).toBeVisible()
  },
}

export const WorldStateClampedDelta: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    sceneEntities: [CHAR_A],
    currentLocationId: LOC_A,
    entityNames,
    stateReport: {
      layer: 'piggyback_tagged_block',
      worldTimeDelta: -600,
      worldTimeDeltaApplied: 0,
    },
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText('-600s')).toBeVisible()
    expect(screen.getByText(/clamped to 0s/)).toBeVisible()
  },
}

export const WorldStateUnknownEntity: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    // stateReport is immutable while entities stay deletable, so a dangling id is
    // permanent. Never a crash, never a bare UUID.
    sceneEntities: [CHAR_A, GONE],
    currentLocationId: null,
    entityNames: [{ id: CHAR_A, name: 'Aria' }],
    stateReport: { layer: 'piggyback_tagged_block', sceneEntities: [CHAR_A, GONE] },
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText('Unknown entity')).toBeVisible()
    expect(screen.queryByText(GONE)).not.toBeInTheDocument()
  },
}

export const WorldStateLegacyRow: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'ai_reply',
    meta: aiMeta,
    // Written before the write-path strip: markup still in content, no stateReport.
    content:
      'The blade rasps free of its sheath.\n<state><scene_entities>c1</scene_entities></state>',
    sceneEntities: [CHAR_A],
    currentLocationId: null,
    entityNames,
  },
  play: async () => {
    await openPanel()
    expect(screen.getByText(/<scene_entities>c1<\/scene_entities>/)).toBeVisible()
    // Prose is still stripped for display even though the row was never migrated.
    expect(screen.getByText('The blade rasps free of its sheath.')).toBeVisible()
  },
}

export const WorldStateTailEditable: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...reportedProps,
    sceneOptions,
    onEditScene: fn(async () => ({ ok: true }) as const),
  },
  play: async () => {
    await openPanel()
    const trigger = screen.getByRole('button', { name: 'Edit scene' })
    await userEvent.click(trigger)
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit scene' })).toBeVisible())
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // Closing must hand the keyboard back to the control that opened it.
    expect(document.activeElement).toBe(trigger)
  },
}

// A terminal refusal must say why. The generic "try again" sends the user round a loop
// the action layer will refuse identically every time.
export const WorldStateSaveRefused: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...reportedProps,
    sceneOptions,
    onEditScene: fn(async () => ({ ok: false, code: 'not-tail-entry' }) as const),
  },
  play: async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Edit scene' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit scene' })).toBeVisible())
    // An unchanged Save takes the form's cancel route and never reaches onEditScene.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Corin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByText("Only the newest entry's scene can be edited.")).toBeVisible(),
    )
    expect(screen.queryByText('Could not save the scene. Try again.')).not.toBeInTheDocument()
    // The overlay stays open on failure, so the edit is not silently discarded.
    expect(screen.getByRole('dialog', { name: 'Edit scene' })).toBeVisible()
  },
}

// A retryable failure keeps the generic copy, which is accurate for that one case.
export const WorldStateSaveFailed: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...reportedProps,
    sceneOptions,
    onEditScene: fn(async () => ({ ok: false, code: 'delta-failed' }) as const),
  },
  play: async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Edit scene' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit scene' })).toBeVisible())
    await userEvent.click(screen.getByRole('checkbox', { name: 'Corin' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(screen.getByText('Could not save the scene. Try again.')).toBeVisible(),
    )
  },
}

/**
 * The scene dialog's open flag lives in EntryCard's own body, not in a subtree that
 * unmounts with it, so a `disabled` round-trip is exactly where it can outlive the
 * dialog and bring it back unprompted.
 */
export const WorldStateEditDoesNotResurrectAfterGeneration: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    ...aiEntry,
    ...reportedProps,
    sceneOptions,
    onEditScene: fn(async () => ({ ok: true }) as const),
  },
  render: (args) => <ResurrectHarness {...args} />,
  play: async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Edit scene' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit scene' })).toBeVisible())

    setStoryBlocked?.(true)
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit scene' })).not.toBeInTheDocument(),
    )

    setStoryBlocked?.(false)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit scene' })).toBeVisible())
    expect(screen.queryByRole('dialog', { name: 'Edit scene' })).not.toBeInTheDocument()
  },
}

export const WorldStateNonTail: StoryT = {
  ...wrap,
  args: { ...baseProps, ...aiEntry, ...reportedProps },
  play: async () => {
    await openPanel()
    // Absent, not disabled: a control present everywhere but effective only at the
    // tail repeats the failure mode the panel exists to remove.
    expect(screen.queryByRole('button', { name: 'Edit scene' })).not.toBeInTheDocument()
  },
}

export const WorldStateAbsentOnUserAction: StoryT = {
  ...wrap,
  args: {
    ...baseProps,
    kind: 'user_action',
    content: 'I step into the marshes.',
    sceneEntities: [CHAR_A],
    entityNames,
  },
  play: async () => {
    // A user_action's scene metadata is inherited and identical to the entry above
    // it, so a panel there would render the same facts twice.
    expect(screen.queryByRole('button', { name: 'Show state' })).not.toBeInTheDocument()
  },
}
