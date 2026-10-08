import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { ArrowLeft, X } from 'lucide-react-native'
import { useState, type ComponentProps } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { PlotIcon } from '@/components/plot/plot-icon'
import { IconAction } from '@/components/ui/icon-action'
import { t } from '@/lib/i18n'

import { PeekFoot } from './peek-foot'
import { PeekHead } from './peek-head'

const meta: Meta<typeof PeekHead> = {
  title: 'Compounds/Reader/PeekHead',
  component: PeekHead,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: { kind: 'character', name: 'Kael', recentlyClassified: false },
  decorators: [
    (Story) => (
      <View className="rounded-md bg-bg-base" style={{ width: 440 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof PeekHead>

const INACTIVE = 'Only an active character can be the lead'

const setLeadButton = () => screen.queryByRole('button', { name: /^Set as lead/ })

/** The current lead in adventure mode: the rail's accent badge, no action. */
export const LeadYou: Story = {
  args: { lead: { state: 'lead', label: 'you' } },
  play: async () => {
    await expect(screen.getByText('You').parentElement).toHaveClass('bg-accent')
    await expect(setLeadButton()).toBeNull()
    await expect(screen.queryByText('Recently classified')).toBeNull()
  },
}

/** Creative mode swaps the badge's label, not its channel. */
export const LeadProtagonist: Story = {
  args: { lead: { state: 'lead', label: 'protagonist' } },
  play: async () => {
    await expect(screen.getByText('Protagonist').parentElement).toHaveClass('bg-accent')
    await expect(screen.queryByText('You')).toBeNull()
    await expect(setLeadButton()).toBeNull()
  },
}

const onSetLead = fn()

/** An active non-lead character: the inline text-action calls back once. */
export const Candidate: Story = {
  args: {
    name: 'Mira',
    lead: { state: 'candidate', onSetLead, disabledReason: undefined, pending: false },
  },
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    // Phone-only floor: a prior mobile1 story's stale dimensions can linger a commit.
    await waitFor(() => expect(action.getBoundingClientRect().height).toBeLessThan(44))
    // Off phone the group takes no floor and the head keeps its padding.
    const group = screen.getByRole('heading', { name: 'Mira' }).parentElement
    if (group == null) throw new Error('no head group')
    const groupHeight = group.getBoundingClientRect().height
    const headHeight = screen.getByTestId('peek-head').getBoundingClientRect().height
    await expect(groupHeight).toBeLessThan(44)
    await expect(headHeight - groupHeight).toBeGreaterThanOrEqual(20)
    await expect(action).not.toHaveAttribute('aria-disabled', 'true')
    await expect(screen.queryByText('You')).toBeNull()
    await userEvent.click(action)
    await waitFor(() => expect(onSetLead).toHaveBeenCalledTimes(1))
  },
}

const onSetLeadStaged = fn()

/** A staged character can't lead: disabled, the reason in its name and its tooltip. */
export const StagedCandidate: Story = {
  args: {
    name: 'The Ashen Sage',
    lead: {
      state: 'candidate',
      onSetLead: onSetLeadStaged,
      disabledReason: INACTIVE,
      pending: false,
    },
  },
  play: async () => {
    const action = screen.getByRole('button', { name: `Set as lead, ${INACTIVE}` })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action.closest('[title]')).toHaveAttribute('title', INACTIVE)
    // A disabled action stays in the DOM and focusable; a press must still do nothing.
    await userEvent.click(action, { pointerEventsCheck: 0 })
    await expect(onSetLeadStaged).not.toHaveBeenCalled()
  },
}

const onSetLeadPending = fn()

/** While its own call is in flight the action is disabled and busy, with no reason to show. */
export const Pending: Story = {
  args: {
    name: 'Mira',
    lead: {
      state: 'candidate',
      onSetLead: onSetLeadPending,
      disabledReason: undefined,
      pending: true,
    },
  },
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(action, { pointerEventsCheck: 0 })
    await expect(onSetLeadPending).not.toHaveBeenCalled()
  },
}

/** The press itself starts the call, so the focused action turns pending under the key. */
function PressStartsCall(args: ComponentProps<typeof PeekHead>) {
  const [pending, setPending] = useState(false)
  return (
    <PeekHead
      {...args}
      lead={{
        state: 'candidate',
        onSetLead: () => setPending(true),
        disabledReason: undefined,
        pending,
      }}
    />
  )
}

/** A disabled action stays focusable: keyboard users keep their place while a call is in flight. */
export const FocusSurvivesPending: Story = {
  args: { name: 'Mira' },
  render: (args) => <PressStartsCall {...args} />,
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    await userEvent.tab()
    await expect(action).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(action).toHaveAttribute('aria-busy', 'true'))
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toHaveFocus()
  },
}

/** touch.md → Touch-target floor: on phone the action fills a 44px head in every lead state. */
export const CandidatePhoneFloor: Story = {
  args: {
    name: 'Mira',
    lead: { state: 'candidate', onSetLead: fn(), disabledReason: undefined, pending: false },
  },
  globals: { viewport: { value: 'mobile1' } },
  render: (args) => (
    <View>
      <PeekHead {...args} />
      <PeekHead {...args} lead={{ state: 'lead', label: 'you' }} />
    </View>
  ),
  play: async () => {
    const action = screen.getByRole('button', { name: 'Set as lead' })
    await waitFor(() => expect(action.getBoundingClientRect().height).toBeGreaterThanOrEqual(44))
    const [candidate, lead] = screen
      .getAllByTestId('peek-head')
      .map((head) => head.getBoundingClientRect().height)
    await expect(candidate).toBe(lead)
    // The 44px group sets the phone head's height: no padding stacked on top (44 + border).
    await expect(candidate).toBeLessThan(50)
  },
}

/** Non-character kinds get no lead affordance; entity kinds and lore take their kind glyph. */
export const Location: Story = {
  args: { kind: 'location', name: "Veil's Hollow" },
  play: async () => {
    await expect(screen.getByRole('img', { name: 'Location' })).toBeInTheDocument()
    await expect(
      screen.getByRole('heading', { name: "Veil's Hollow", level: 3 }),
    ).toBeInTheDocument()
    await expect(setLeadButton()).toBeNull()
    await expect(screen.queryByText('You')).toBeNull()
  },
}

/** A thread's head carries its own catalog icon, not a kind glyph. */
export const ThreadWithIcon: Story = {
  args: { kind: 'thread', name: 'What the amulet wants', icon: 'swords' },
  render: (args) => (
    <View>
      <PeekHead {...args} />
      <View testID="glyph-swords" className="hidden">
        <PlotIcon kind="thread" icon="swords" />
      </View>
      <View testID="glyph-fallback" className="hidden">
        <PlotIcon kind="thread" icon={null} />
      </View>
    </View>
  ),
  play: async () => {
    const paths = (testID: string) => screen.getByTestId(testID).querySelector('svg')?.innerHTML
    const head = paths('peek-head')
    await expect(head).toBeTruthy()
    await expect(head).toBe(paths('glyph-swords'))
    await expect(head).not.toBe(paths('glyph-fallback'))
    await expect(screen.queryByRole('img')).toBeNull()
    await expect(setLeadButton()).toBeNull()
  },
}

/** C1: the classifier touched this row in the last turns. */
export const RecentlyClassified: Story = {
  args: { name: 'Mira', recentlyClassified: true },
  play: async () => {
    await expect(screen.getByText('Recently classified').parentElement).toHaveClass(
      'bg-recently-classified-bg',
    )
  },
}

const onClose = fn()

/** Desktop / tablet: space-between, the × at the far end. */
export const DesktopClose: Story = {
  args: {
    lead: { state: 'lead', label: 'you' },
    trailing: <IconAction icon={X} label={t('reader:peek.close')} onPress={onClose} />,
  },
  play: async () => {
    const head = screen.getByTestId('peek-head').getBoundingClientRect()
    const name = screen.getByRole('heading', { name: 'Kael' }).getBoundingClientRect()
    const close = screen.getByRole('button', { name: 'Close peek' })
    const box = close.getBoundingClientRect()
    await expect(head.right - box.right).toBeLessThanOrEqual(24)
    await expect(box.left - name.right).toBeGreaterThan(100)
    await userEvent.click(close)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  },
}

const onBack = fn()

/** Phone: the icon-only ← leads, and the head is flex-start so the name sits right after it. */
export const PhoneBack: Story = {
  args: {
    name: 'Mira',
    leading: <IconAction icon={ArrowLeft} label={t('reader:peek.back')} onPress={onBack} />,
  },
  decorators: [
    (Story) => (
      <View style={{ width: 375 }}>
        <Story />
      </View>
    ),
  ],
  play: async () => {
    const back = screen.getByRole('button', { name: 'Back to Browse' })
    const name = screen.getByRole('heading', { name: 'Mira' }).getBoundingClientRect()
    await expect(name.left - back.getBoundingClientRect().right).toBeLessThan(48)
    await userEvent.click(back)
    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
  },
}

const onOpenWorld = fn()

/** World categories escalate to the World panel. */
export const FootWorld: Story = {
  render: () => <PeekFoot category="character" onOpenInPanel={onOpenWorld} />,
  play: async () => {
    await expect(screen.queryByRole('link', { name: 'Open in Plot panel →' })).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Open in World panel →' }))
    await waitFor(() => expect(onOpenWorld).toHaveBeenCalledTimes(1))
  },
}

/** touch.md → Touch-target floor: the phone foot link is at least 44px tall. */
export const FootPhoneFloor: Story = {
  render: () => <PeekFoot category="character" onOpenInPanel={fn()} />,
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    const link = screen.getByRole('link', { name: 'Open in World panel →' })
    await waitFor(() => expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(44))
  },
}

const onOpenPlot = fn()

/** Threads and happenings escalate to the Plot panel. */
export const FootPlot: Story = {
  render: () => <PeekFoot category="happening" onOpenInPanel={onOpenPlot} />,
  play: async () => {
    await expect(screen.queryByRole('link', { name: 'Open in World panel →' })).toBeNull()
    await userEvent.click(screen.getByRole('link', { name: 'Open in Plot panel →' }))
    await waitFor(() => expect(onOpenPlot).toHaveBeenCalledTimes(1))
  },
}
