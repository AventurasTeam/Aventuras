import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'

import { EntryJumpVeil } from './entry-jump-veil'
import type { JumpVeil } from './use-entry-jump'

// The real veil's delay and fail-safe live in useEntryJump's tests; this one shows on command.
function stubVeil(): JumpVeil & { show: (next: boolean) => void } {
  let shown = false
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => shown,
    isWaiting: () => shown,
    show: (next) => {
      shown = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const veil = stubVeil()

const meta: Meta<typeof EntryJumpVeil> = {
  title: 'Compounds/Reader/EntryJumpVeil',
  component: EntryJumpVeil,
  decorators: [
    (Story) => (
      <View style={{ height: 320 }}>
        <Story />
      </View>
    ),
  ],
  args: { veil },
}

export default meta
type Story = StoryObj<typeof EntryJumpVeil>

/** The veil covers the reader while its jump waits, and lifts with it. */
export const ShowsWhileTheJumpWaits: Story = {
  play: async () => {
    veil.show(false)
    const loading = t('reader:jumpLoading')
    await waitFor(() => expect(screen.queryByText(loading)).toBeNull())
    veil.show(true)
    await waitFor(() => expect(screen.getByText(loading)).toBeInTheDocument())
    veil.show(false)
    await waitFor(() => expect(screen.queryByText(loading)).toBeNull())
  },
}
