import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import { ReasonButton } from './reason-button'

const LABEL = 'Close chapter'
const REASON = t('generationGate.inFlight')

const meta = {
  title: 'Compounds/ReasonButton',
  component: ReasonButton,
  parameters: { layout: 'centered' },
  args: { onPress: fn(), children: <Text>{LABEL}</Text> },
  decorators: [
    (Story) => (
      <View testID="reason-button-frame" className="w-[360px] gap-2 p-4">
        <Story />
      </View>
    ),
  ],
} satisfies Meta<typeof ReasonButton>

export default meta
type Story = StoryObj<typeof meta>

const button = () => screen.getByRole('button', { name: LABEL })
const frameWidth = () => screen.getByTestId('reason-button-frame').getBoundingClientRect().width

export const Enabled: Story = {
  play: async ({ args }) => {
    await userEvent.click(button())
    await expect(args.onPress).toHaveBeenCalledOnce()
    expect(screen.queryByTitle(REASON)).toBeNull()
  },
}

// Web carries the reason as Button's tooltip; the muted line under it is native's alone.
export const DisabledWithReason: Story = {
  args: { disabled: true, disabledReason: REASON },
  play: async () => {
    await expect(button()).toHaveAttribute('aria-disabled', 'true')
    await expect(screen.getByTitle(REASON)).toContainElement(button())
    expect(screen.queryByText(REASON)).toBeNull()
  },
}

// A reason passed to an enabled button explains nothing: no tooltip, no line.
export const EnabledWithReasonPassed: Story = {
  args: { disabledReason: REASON },
  play: async () => {
    await expect(button()).not.toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByTitle(REASON)).toBeNull()
    expect(screen.queryByText(REASON)).toBeNull()
  },
}

export const StartLayout: Story = {
  args: { disabled: true, disabledReason: REASON },
  play: async () => {
    await waitFor(() =>
      expect(button().getBoundingClientRect().width).toBeLessThan(frameWidth() * 0.5),
    )
  },
}

export const StretchLayout: Story = {
  args: { layout: 'stretch', disabled: true, disabledReason: REASON },
  play: async () => {
    await waitFor(() =>
      expect(button().getBoundingClientRect().width).toBeGreaterThan(frameWidth() * 0.8),
    )
  },
}
