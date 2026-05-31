import type { Meta, StoryObj } from '@storybook/react-native-web-vite'

import { SettingsRecoveryScreen } from './settings-recovery-screen'

const meta = {
  title: 'Shells/SettingsRecoveryScreen',
  component: SettingsRecoveryScreen,
  parameters: { layout: 'fullscreen' },
  args: { onReset: () => undefined },
} satisfies Meta<typeof SettingsRecoveryScreen>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
