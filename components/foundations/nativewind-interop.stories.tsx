import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect } from 'storybook/test'

// Guards the harness, not a component: react-native-css-interop's wrap-jsx
// skips its own component registration when NODE_ENV is 'test', so without a
// setup-file import every className in a story is inert and every style
// assertion passes vacuously. This story fails loudly if that regresses.
const meta = {
  title: 'Foundations/NativeWind interop',
  component: View,
} satisfies Meta<typeof View>

export default meta
type Story = StoryObj<typeof meta>

export const ClassNamesReachStyles: Story = {
  render: () => (
    // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
    <View className="hidden rounded-md" dataSet={{ probe: 'interop' }} />
  ),
  play: async ({ canvasElement }) => {
    const probe = canvasElement.querySelector('[data-probe="interop"]')
    await expect(probe).not.toBeNull()
    if (!probe) return
    await expect(probe).toHaveClass('hidden')
    await expect(probe).toHaveClass('rounded-md')
    const computed = getComputedStyle(probe)
    await expect(computed.display).toBe('none')
    await expect(computed.borderRadius).not.toBe('0px')
  },
}
