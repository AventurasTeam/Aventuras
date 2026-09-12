import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { CollisionReviewPill } from './collision-review-pill'

const meta: Meta<typeof CollisionReviewPill> = {
  title: 'Compounds/World/CollisionReviewPill',
  component: CollisionReviewPill,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof CollisionReviewPill>

export const Desktop: Story = {
  args: { count: 1, onPress: fn() },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '⚠ 1 need review' }))
    await waitFor(() => expect(args.onPress).toHaveBeenCalled())
  },
}

export const Phone: Story = {
  args: { count: 3, onPress: fn() },
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    // Dimensions caching + the async resize event mean the phone-tier render lands a tick after mount.
    await waitFor(() => expect(screen.getByRole('button', { name: '⚠ 3' })).toBeInTheDocument())
  },
}

export const Zero: Story = {
  args: { count: 0, onPress: fn() },
  play: async () => {
    expect(screen.queryByRole('button')).toBeNull()
  },
}
