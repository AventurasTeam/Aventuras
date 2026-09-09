import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'

import { EmbedWindowTextarea } from './embed-window-textarea'

const meta: Meta<typeof EmbedWindowTextarea> = {
  title: 'Compounds/EmbedWindowTextarea',
  component: EmbedWindowTextarea,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EmbedWindowTextarea>

/**
 * The counter reads the app's configured embedder, so in Storybook — with no
 * embedder configured — the window is unknown and it stays quiet by design. That
 * is the same state a fresh install is in, and it is the one worth seeing: the
 * field must look ordinary, and the reserved counter row must not shift it.
 */
export const Default: Story = {
  render: () => {
    const [body, setBody] = useState('')
    return (
      <View style={{ width: 420, gap: 8 }}>
        <EmbedWindowTextarea
          value={body}
          onChangeText={setBody}
          placeholder="Lore body…"
          rows={5}
        />
        <Text className="text-xs text-fg-muted">
          Counter appears from 75% of the embedder&apos;s input window.
        </Text>
      </View>
    )
  },
}

/** Long enough to cross the window on any configured embedder. */
export const LongBody: Story = {
  render: () => {
    const [body, setBody] = useState(
      'The harbour fog rolled over the quay at dawn. '.repeat(200).trim(),
    )
    return (
      <View style={{ width: 420 }}>
        <EmbedWindowTextarea value={body} onChangeText={setBody} rows={8} />
      </View>
    )
  },
}
