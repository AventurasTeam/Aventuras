import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, spyOn, userEvent, waitFor } from 'storybook/test'

import { t } from '@/lib/i18n'
import { toastStore, type ToastItem } from '@/lib/toast'

import { JSONBlock } from './json-block'

const meta: Meta<typeof JSONBlock> = {
  title: 'Primitives/JSONBlock',
  component: JSONBlock,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof JSONBlock>

const SAMPLE_OBJECT = {
  attempt: 2,
  latencyMs: 1840,
  status: 200,
  source: 'provider:anthropic-main',
}

/** Copy shares the text's top inset, so it never sits flush on a divider above the block. */
export const Basic: Story = {
  render: () => (
    <View className="w-96 p-4">
      <JSONBlock data={SAMPLE_OBJECT} />
    </View>
  ),
  play: async () => {
    const copy = await screen.findByRole('button', { name: 'Copy' })
    const text = screen.getByText(/"attempt": 2/)
    const inset = parseFloat(getComputedStyle(text).paddingTop)
    expect(inset).toBeGreaterThan(0)
    expect(copy.getBoundingClientRect().top - text.getBoundingClientRect().top).toBe(inset)
  },
}

export const CopiesFormattedJson: Story = {
  render: () => (
    <View className="w-96 p-4">
      <JSONBlock data={{ attempt: 2 }} />
    </View>
  ),
  beforeEach: () => {
    // A toast left by another story would satisfy the assertion below.
    toastStore.__reset()
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    return () => write.mockRestore()
  },
  play: async () => {
    let toasts: ToastItem[] = []
    const stop = toastStore.subscribe((next) => {
      toasts = next
    })
    try {
      await userEvent.click(await screen.findByRole('button', { name: 'Copy' }))
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "attempt": 2\n}'),
      )
      await waitFor(() =>
        expect(toasts.map((item) => [item.severity, item.message])).toEqual([
          ['info', t('common:clipboard.copied')],
        ]),
      )
    } finally {
      stop()
    }
  },
}

export const NestedObject: Story = {
  render: () => (
    <View className="w-96 p-4">
      <JSONBlock
        data={{
          request: { method: 'POST', url: 'https://api.example.com/v1/messages' },
          response: { status: 200, body: { id: 'abc', tokens: 142 } },
        }}
      />
    </View>
  ),
}

export const CircularReference: Story = {
  render: () => {
    const circular: { self?: unknown; name: string } = { name: 'circular' }
    circular.self = circular
    return (
      <View className="w-96 p-4">
        <JSONBlock data={circular} />
      </View>
    )
  },
}

export const EmptyObject: Story = {
  render: () => (
    <View className="w-96 p-4">
      <JSONBlock data={{}} />
    </View>
  ),
}
