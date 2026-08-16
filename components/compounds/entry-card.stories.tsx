import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState, type ReactElement } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { EARTH_GREGORIAN } from '@/lib/calendar'
import { themes } from '@/lib/themes'
import { toastStore, type ToastItem } from '@/lib/toast'

import { EntryCard, type EntryCardProps } from './entry-card'

const baseProps = {
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

// `subscribe` replays the queue to a new listener synchronously, so this reads
// the live store without mounting a Toaster.
function currentToasts(): ToastItem[] {
  let items: ToastItem[] = []
  toastStore.subscribe((next) => {
    items = next
  })()
  return items
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

export const SystemRetryFires: StoryT = {
  ...wrap,
  args: {
    kind: 'system',
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
        kind="opening"
        content="The road from Ironshore is empty for a hundred miles."
        worldTimeLabel="Day 1 · 06:00"
        meta={{ tokens: { prompt: 1120, completion: 89 } }}
        onEdit={fn()}
        onBranch={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
        kind="user_action"
        content="I keep riding."
        worldTimeLabel="Day 1 · 06:05"
        onEdit={fn()}
        onDelete={fn()}
        onFlipEra={fn()}
      />
      <EntryCard
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
        kind="streaming"
        streamingPhase="reasoning"
        content=""
        reasoning="Working out the warden's first words…"
      />
      <EntryCard
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
              kind="user_action"
              content="I keep riding."
              worldTimeLabel="Day 1 · 06:05"
              onEdit={fn()}
              onDelete={fn()}
            />
            <EntryCard
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

    // Still open, still holding what was typed.
    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
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
    toastStore.__reset()
    await userEvent.click(screen.getByRole('button', { name: 'Edit time' }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toBeVisible())

    await userEvent.clear(screen.getByRole('textbox', { name: 'Second' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Second' }), '45')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45'))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledWith(105))

    // The rejection is reported, not swallowed. Without the catch the overlay
    // would look identical, so this is the assertion that carries the fix.
    await waitFor(() => expect(currentToasts().map((item) => item.severity)).toEqual(['error']))

    // Overlay survives with the typed tuple, and Save still works on a retry.
    expect(screen.getByRole('dialog', { name: 'Edit time' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Second' })).toHaveValue('45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(args.onEditTime).toHaveBeenCalledTimes(2))
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
