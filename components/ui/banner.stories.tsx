import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { fn } from 'storybook/test'

import { Banner } from './banner'

const meta: Meta<typeof Banner> = {
  title: 'UI/Banner',
  component: Banner,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
}
export default meta
type StoryT = StoryObj<typeof Banner>

export const AiNotConfigured: StoryT = {
  args: {
    message: 'AI generation not configured.',
    ctaLabel: 'Set up a provider →',
    onCta: fn(),
  },
}
