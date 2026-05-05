import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { FormRow } from '@/components/compounds/form-row'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'

const WIDTH_OPTIONS = [320, 480, 720, 960] as const
type WidthOption = (typeof WIDTH_OPTIONS)[number]

function ControlledInput(props: React.ComponentProps<typeof Input>) {
  const [value, setValue] = React.useState('')
  return <Input value={value} onChangeText={setValue} {...props} />
}

export default function FormRowDevRoute() {
  const [width, setWidth] = React.useState<WidthOption>(720)
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-2">
          <Heading level={2}>Container width</Heading>
          <Text size="sm" variant="muted">
            FormRow keys its layout off the wrapper width, not the viewport tier. Switch the width
            below to see the rule fire — &lt; 640 px stacks; ≥ 640 px goes 2-col.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {WIDTH_OPTIONS.map((w) => (
              <Chip key={w} selected={width === w} onPress={() => setWidth(w)}>
                <Text>{w} px</Text>
              </Chip>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Window-responsive (full-width)</Heading>
          <Text size="sm" variant="muted">
            The wrapper has no fixed width — it consumes the page&apos;s. Drag the Electron window
            across 640 px and the row flips between stacked and 2-col. This is the authentic
            auto-detect test; chip-driven width changes below trigger the same onLayout path but
            don&apos;t prove the resize-stream wiring.
          </Text>
          <View className="gap-4 rounded-md border border-border bg-bg-base p-4">
            <FormRow label="Display name" required hint="Resize the window to see the flip.">
              <ControlledInput placeholder="Name…" />
            </FormRow>
            <FormRow label="Email" error="Enter a valid email address">
              <ControlledInput placeholder="you@example.com" aria-invalid />
            </FormRow>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Fixed-width chip switcher</Heading>
          <Text size="sm" variant="muted">
            Resize via the chips above. Pins the wrapper to a discrete width so each threshold can
            be sampled deterministically — useful for visual review at the border of the 640 px /
            1024 px breakpoints.
          </Text>
          <View className="gap-4 rounded-md border border-border bg-bg-base p-4" style={{ width }}>
            <FormRow label="Display name" required hint="Shown on entries you author.">
              <ControlledInput placeholder="Name…" />
            </FormRow>
            <FormRow label="Tagline" hint="One short line, no markdown.">
              <ControlledInput placeholder="A short blurb…" />
            </FormRow>
            <FormRow label="Email" required error="Enter a valid email address">
              <ControlledInput placeholder="you@example.com" aria-invalid />
            </FormRow>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Forced stacked override</Heading>
          <Text size="sm" variant="muted">
            `stacked` prop locks the narrow shape regardless of measured width. Use for
            tablet-portrait detail panes where the rail steals room but window dimensions don&apos;t
            reflect that.
          </Text>
          <View className="rounded-md border border-border bg-bg-base p-4" style={{ width: 720 }}>
            <FormRow label="Display name" stacked hint="Forced stacked at 720 px.">
              <ControlledInput placeholder="Name…" />
            </FormRow>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
