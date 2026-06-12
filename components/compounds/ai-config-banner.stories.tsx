import type { Meta, StoryObj } from '@storybook/react-native-web-vite'

import { AiConfigBanner } from './ai-config-banner'

const meta: Meta<typeof AiConfigBanner> = {
  title: 'Compounds/AiConfigBanner',
  component: AiConfigBanner,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof AiConfigBanner>

export const Default: Story = {
  render: () => <AiConfigBanner onPressCta={() => {}} />,
}
