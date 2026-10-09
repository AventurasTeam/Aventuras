import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { expect, fn, screen, userEvent } from 'storybook/test'

import { EntryIndexStatus } from './entry-index-status'

const meta: Meta<typeof EntryIndexStatus> = {
  title: 'Compounds/EntryIndexStatus',
  component: EntryIndexStatus,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  args: {
    failed: false,
    onRetry: fn(),
    loadingTitle: 'Loading happenings…',
    failedTitle: "Couldn't read the story's entries.",
    failedBody: 'The rail reads them again when the next run finishes, or when you retry.',
    retryLabel: 'Retry',
  },
}

export default meta
type Story = StoryObj<typeof EntryIndexStatus>

export const Loading: Story = {
  play: async () => {
    expect(screen.getByText('Loading happenings…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  },
}

export const FailedOffersRetry: Story = {
  args: { failed: true },
  play: async ({ args }) => {
    expect(screen.getByText("Couldn't read the story's entries.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(args.onRetry).toHaveBeenCalledTimes(1)
  },
}
