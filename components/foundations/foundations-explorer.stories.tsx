import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { FoundationsExplorer } from './foundations-explorer'

const meta: Meta<typeof FoundationsExplorer> = {
  title: 'Foundations/Explorer',
  component: FoundationsExplorer,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof FoundationsExplorer>

export const Default: Story = {}
