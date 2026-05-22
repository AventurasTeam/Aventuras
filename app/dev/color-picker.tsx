import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { ColorPicker, type ColorValue } from '@/components/ui/color-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

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

function contrastWarning(hex: string) {
  const v = hex.toLowerCase()
  if (v <= '#222222' || v >= '#eeeeee') {
    return (
      <Text size="xs" className="text-danger">
        Low contrast on the current theme — pick something with more contrast.
      </Text>
    )
  }
  return null
}

export default function ColorPickerDevRoute() {
  const [basic, setBasic] = useState<ColorValue | null>(null)
  const [withCustom, setWithCustom] = useState<ColorValue | null>(SAMPLE_PALETTE[2])
  const [withWarning, setWithWarning] = useState<ColorValue | null>(null)

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Default</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Curated swatches plus a dashed (none) fallback. value=null shows the fallback as
            selected.
          </Text>
          <View className="mt-3 flex-col gap-2">
            <ColorPicker
              swatches={SAMPLE_PALETTE}
              value={basic}
              onChange={setBasic}
              fallbackColor={FALLBACK}
              fallbackLabel="Use theme accent"
            />
            <Text size="xs" variant="muted">
              value: {basic ?? 'null (fallback)'}
            </Text>
          </View>
        </View>
        <View>
          <Heading level={3}>With custom</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            + custom opens a Popover (desktop / tablet) or a bottom Sheet (phone) with the color
            picker library, a hex field, and Apply / Cancel. Apply commits; outside-click or Cancel
            discards.
          </Text>
          <View className="mt-3 flex-col gap-2">
            <ColorPicker
              swatches={SAMPLE_PALETTE}
              value={withCustom}
              onChange={setWithCustom}
              fallbackColor={FALLBACK}
              fallbackLabel="Use theme accent"
              allowCustom
            />
            <Text size="xs" variant="muted">
              value: {withCustom ?? 'null (fallback)'}
            </Text>
          </View>
        </View>
        <View>
          <Heading level={3}>With warning</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            customWarning(localHex) renders inside the overlay; here it warns on very dark / very
            light hexes.
          </Text>
          <View className="mt-3 flex-col gap-2">
            <ColorPicker
              swatches={SAMPLE_PALETTE}
              value={withWarning}
              onChange={setWithWarning}
              fallbackColor={FALLBACK}
              fallbackLabel="Use theme accent"
              allowCustom
              customWarning={contrastWarning}
            />
            <Text size="xs" variant="muted">
              value: {withWarning ?? 'null (fallback)'}
            </Text>
          </View>
        </View>
        <View>
          <Heading level={3}>Disabled</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            pointerEvents=none + opacity-50; all swatches inert.
          </Text>
          <View className="mt-3">
            <ColorPicker
              swatches={SAMPLE_PALETTE}
              value={SAMPLE_PALETTE[3]}
              onChange={() => undefined}
              fallbackColor={FALLBACK}
              fallbackLabel="Use theme accent"
              allowCustom
              disabled
            />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
