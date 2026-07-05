import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fireEvent, fn, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'

import { WizardShell } from './wizard-shell'

function StepBodyPlaceholder({ label }: { label: string }) {
  return (
    <View className="flex-1 items-center justify-center py-12">
      <Text variant="muted">{label}</Text>
    </View>
  )
}

const meta: Meta<typeof WizardShell> = {
  title: 'Compounds/Wizard/WizardShell',
  component: WizardShell,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof WizardShell>

export const Step1Frame: Story = {
  args: {
    step: 1,
    canGoNext: true,
    isFinish: false,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    canJumpTo: () => false,
    children: <StepBodyPlaceholder label="Step 1 — Frame" />,
  },
  play: async ({ canvas, args }) => {
    // ← Back is hidden on step 1.
    expect(canvas.queryByRole('button', { name: '← Back' })).toBeNull()

    // World / Cast are hard-disabled in M2 regardless of step — non-interactive.
    const world = await canvas.findByRole('button', { name: 'World' })
    const cast = await canvas.findByRole('button', { name: 'Cast' })
    expect(world).toBeDisabled()
    expect(cast).toBeDisabled()
    fireEvent.click(world)
    fireEvent.click(cast)
    expect(args.onJump).not.toHaveBeenCalled()
  },
}

export const Step2Calendar: Story = {
  args: {
    step: 2,
    canGoNext: true,
    isFinish: false,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    canJumpTo: (target: number) => target < 2,
    children: <StepBodyPlaceholder label="Step 2 — Calendar" />,
  },
  play: async ({ canvas, args }) => {
    const back = await canvas.findByRole('button', { name: '← Back' })
    await userEvent.click(back)
    await waitFor(() => expect(args.onBack).toHaveBeenCalledTimes(1))

    // Frame (step 1) is completed — backward-jump clickable.
    const frame = await canvas.findByRole('button', { name: 'Frame' })
    await userEvent.click(frame)
    await waitFor(() => expect(args.onJump).toHaveBeenCalledWith(1))
  },
}

export const ForwardJumpToVisited: Story = {
  args: {
    step: 1,
    canGoNext: true,
    isFinish: false,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    // Simulates a session that reached Opening then stepped back to Frame:
    // every non-active step is a valid forward/backward jump target.
    canJumpTo: (target: number) => target !== 1,
    children: <StepBodyPlaceholder label="Step 1 — forward-jump to a visited step" />,
  },
  play: async ({ canvas, args }) => {
    // Opening (step 5) was visited — forward-jump is clickable.
    const opening = await canvas.findByRole('button', { name: 'Opening' })
    await userEvent.click(opening)
    await waitFor(() => expect(args.onJump).toHaveBeenCalledWith(5))

    // World / Cast stay disabled even though canJumpTo would return true.
    expect(await canvas.findByRole('button', { name: 'World' })).toBeDisabled()
  },
}

export const Step5Opening: Story = {
  args: {
    step: 5,
    canGoNext: true,
    isFinish: true,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    canJumpTo: (target: number) => target < 5,
    children: <StepBodyPlaceholder label="Step 5 — Opening & finish" />,
  },
  play: async ({ canvas }) => {
    // Next → becomes Finish on the last step.
    expect(await canvas.findByRole('button', { name: 'Finish' })).toBeInTheDocument()
    expect(canvas.queryByRole('button', { name: 'Next →' })).toBeNull()
  },
}

export const NextDisabledUntilValid: Story = {
  args: {
    step: 2,
    canGoNext: false,
    isFinish: false,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    canJumpTo: () => false,
    children: <StepBodyPlaceholder label="Next → disabled until the step passes validation" />,
  },
  play: async ({ canvas }) => {
    expect(await canvas.findByRole('button', { name: 'Next →' })).toBeDisabled()
  },
}

export const PhoneCollapsed: Story = {
  render: (args) => (
    <View className="gap-2">
      <Text variant="muted" size="sm" className="px-3 pt-2">
        375 px wrapper is layout-only — `useTier()` reads window dimensions, so the pill row only
        collapses to dots when the Storybook window itself is &lt; 640 px wide. Resize the browser
        to verify the phone collapse.
      </Text>
      <View
        style={{ width: 375, height: 700 }}
        className="overflow-hidden rounded-md border border-border"
      >
        <WizardShell {...args} />
      </View>
    </View>
  ),
  args: {
    step: 2,
    canGoNext: true,
    isFinish: false,
    onCancel: fn(),
    onBack: fn(),
    onNext: fn(),
    onSaveDraft: fn(),
    onJump: fn(),
    canJumpTo: () => false,
    children: <StepBodyPlaceholder label="Phone tier — pill labels collapse to dots-only" />,
  },
}
