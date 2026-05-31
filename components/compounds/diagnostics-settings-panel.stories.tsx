import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test'

import { DiagnosticsSettingsPanel } from './diagnostics-settings-panel'

const meta: Meta<typeof DiagnosticsSettingsPanel> = {
  title: 'Compounds/DiagnosticsSettingsPanel',
  component: DiagnosticsSettingsPanel,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <View style={{ width: 420 }}>
        <Story />
      </View>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof DiagnosticsSettingsPanel>

// Master off → debug row disabled; toggling master fires the handler with `true`.
export const MasterOff: Story = {
  args: { enabled: false, debugEnabled: false, onToggleEnabled: fn(), onToggleDebug: fn() },
  play: async ({ args }) => {
    const master = screen.getByRole('switch', { name: 'Enable diagnostics capture' })
    const debug = screen.getByRole('switch', { name: 'Include debug-level emissions' })
    await expect(debug).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(master)
    await waitFor(() => expect(args.onToggleEnabled).toHaveBeenCalledWith(true))
  },
}

// Master on → debug row enabled; toggling it fires the handler with `true`.
export const MasterOn: Story = {
  args: { enabled: true, debugEnabled: false, onToggleEnabled: fn(), onToggleDebug: fn() },
  play: async ({ args }) => {
    const debug = screen.getByRole('switch', { name: 'Include debug-level emissions' })
    expect(debug).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(debug)
    await waitFor(() => expect(args.onToggleDebug).toHaveBeenCalledWith(true))
  },
}

// Live state — both toggles drive local state (visual + manual reference).
export const Interactive: Story = {
  render: () => {
    const [enabled, setEnabled] = useState(false)
    const [debug, setDebug] = useState(false)
    return (
      <DiagnosticsSettingsPanel
        enabled={enabled}
        debugEnabled={debug}
        onToggleEnabled={setEnabled}
        onToggleDebug={setDebug}
      />
    )
  },
}
