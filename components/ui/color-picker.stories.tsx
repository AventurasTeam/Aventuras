import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent } from 'storybook/test'

import { t } from '@/lib/i18n'

import { ColorPicker, type ColorValue } from './color-picker'
import { Text } from './text'

const SAMPLE_PALETTE = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#0ea5e9',
  '#6366f1',
  '#a855f7',
  '#ec4899',
]

const FALLBACK = '#64748b'

const meta: Meta<typeof ColorPicker> = {
  title: 'Primitives/ColorPicker',
  component: ColorPicker,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof ColorPicker>

export const Default: Story = {
  render: () => {
    const [value, setValue] = useState<ColorValue | null>(null)
    return (
      <View className="flex-col items-start gap-3 p-8">
        <ColorPicker
          swatches={SAMPLE_PALETTE}
          value={value}
          onChange={setValue}
          fallbackColor={FALLBACK}
          fallbackLabel="Use theme accent"
        />
        <Text size="xs" variant="muted">
          value: {value ?? 'null (fallback)'}
        </Text>
      </View>
    )
  },
}

export const WithCustom: Story = {
  render: () => {
    const [value, setValue] = useState<ColorValue | null>(null)
    return (
      <View className="flex-col items-start gap-3 p-8">
        <ColorPicker
          swatches={SAMPLE_PALETTE}
          value={value}
          onChange={setValue}
          fallbackColor={FALLBACK}
          fallbackLabel="Use theme accent"
          allowCustom
        />
        <Text size="xs" variant="muted">
          value: {value ?? 'null (fallback)'}
        </Text>
      </View>
    )
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: t('colorPicker.pickCustomColor') }))

    expect(
      await screen.findByRole('heading', { name: t('colorPicker.customColor') }),
    ).toBeInTheDocument()
    const input = screen.getByLabelText(t('colorPicker.hexColor'))
    await userEvent.clear(input)
    await userEvent.type(input, '#12')

    expect(
      screen.getByText(t('colorPicker.invalidHex', { example: '#3b82f6' })),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('cancel') })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: t('colorPicker.apply') })).toBeDisabled()
  },
}

export const Disabled: Story = {
  render: () => (
    <View className="flex-col items-start gap-3 p-8">
      <ColorPicker
        swatches={SAMPLE_PALETTE}
        value={SAMPLE_PALETTE[3]}
        onChange={() => undefined}
        fallbackColor={FALLBACK}
        fallbackLabel="Use theme accent"
        allowCustom
        disabled
      />
      <Text size="xs" variant="muted">
        Disabled: pointer-events suppressed, opacity-50.
      </Text>
    </View>
  ),
}

export const WithWarning: Story = {
  render: () => {
    const [value, setValue] = useState<ColorValue | null>(null)
    const contrastWarning = (hex: string) => {
      const isVeryDark = hex.toLowerCase() <= '#222222'
      const isVeryLight = hex.toLowerCase() >= '#eeeeee'
      if (!isVeryDark && !isVeryLight) return null
      return (
        <Text size="xs" className="text-danger">
          Low contrast on the current theme — pick something with more contrast.
        </Text>
      )
    }
    return (
      <View className="flex-col items-start gap-3 p-8">
        <ColorPicker
          swatches={SAMPLE_PALETTE}
          value={value}
          onChange={setValue}
          fallbackColor={FALLBACK}
          fallbackLabel="Use theme accent"
          allowCustom
          customWarning={contrastWarning}
        />
        <Text size="xs" variant="muted">
          Open the + custom chip and pick a very dark / very light color to see the warning.
        </Text>
      </View>
    )
  },
}

// No ThemeMatrix story for ColorPicker: the custom-color overlay portals to
// document body, escaping per-row `dataSet={{theme}}` scope. Use the
// Storybook toolbar's global theme switcher, or visit the native dev page at
// /dev/color-picker where the ThemePicker drives data-theme globally.
