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
    const pill = screen.getByRole('button', { name: '1 needs review' })
    expect(pill).toHaveTextContent(/^⚠ 1 needs review$/)
    await userEvent.click(pill)
    await waitFor(() => expect(args.onPress).toHaveBeenCalled())
  },
}

export const Phone: Story = {
  args: { count: 3, onPress: fn() },
  globals: { viewport: { value: 'mobile1' } },
  play: async () => {
    // Dimensions caching + the async resize event mean the phone-tier render lands a tick after mount.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '3 need review' })).toHaveTextContent(/^⚠ 3$/),
    )
  },
}

export const Zero: Story = {
  args: { count: 0, onPress: fn() },
  play: async () => {
    expect(screen.queryByRole('button')).toBeNull()
  },
}
