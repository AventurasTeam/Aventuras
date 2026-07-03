import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent, waitFor } from 'storybook/test'

import { wizardStore } from '@/lib/stores'

import { StepFrame } from './step-frame'

// StepFrame reads the wizardStore singleton directly (no props) — each story
// reseeds the working-state in `beforeEach` so a prior story's picks never
// leak into the next one.
const meta: Meta<typeof StepFrame> = {
  title: 'Compounds/Wizard/StepFrame',
  component: StepFrame,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View className="w-[640px] gap-4 rounded-md bg-bg-base p-6">
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof StepFrame>

export const CreativeThird: Story = {
  beforeEach: () => {
    wizardStore.reset()
  },
  play: async () => {
    expect(await screen.findByText('How is this story told?')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Creative/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Third/ })).toBeChecked()

    // Permissive default — no forward-pointer notice, no lead-name field.
    expect(screen.queryByText(/require a lead character/)).not.toBeInTheDocument()
    expect(screen.queryByText('Lead character name')).not.toBeInTheDocument()
  },
}

export const AdventureFirst: Story = {
  beforeEach: () => {
    wizardStore.reset()
    wizardStore.patchDefinition({ mode: 'adventure', narration: 'first' })
  },
  play: async () => {
    expect(screen.getByRole('radio', { name: /Adventure/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /First/ })).toBeChecked()

    expect(
      await screen.findByText('This combination will require a lead character in Cast.'),
    ).toBeInTheDocument()

    const leadInput = screen.getByPlaceholderText('e.g. Aria Stoneheart')
    await userEvent.type(leadInput, 'Aria')
    await waitFor(() => expect(wizardStore.getWizard().state.leadName).toBe('Aria'))
  },
}
