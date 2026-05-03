import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Button } from './button'
import { Heading } from './heading'
import { Sheet, SheetContent, SheetTrigger } from './sheet'
import { Text } from './text'

const meta: Meta<typeof Sheet> = {
  title: 'Primitives/Sheet',
  component: Sheet,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Sheet>

export const Default: Story = {
  render: () => (
    <View className="items-center justify-center p-8">
      <Sheet>
        <SheetTrigger asChild>
          <Button>
            <Text>Open sheet</Text>
          </Button>
        </SheetTrigger>
        <SheetContent>
          <View className="flex-col gap-3">
            <Heading level={3}>Sheet</Heading>
            <Text variant="muted" size="sm">
              Bottom-anchored, medium height. Tap outside or press Escape to dismiss.
              Drag-to-dismiss lands with the post-phase-2 animation pass.
            </Text>
          </View>
        </SheetContent>
      </Sheet>
    </View>
  ),
}

export const Anchors: Story = {
  render: () => (
    <View className="flex-col items-center gap-6 p-8">
      <Text variant="muted" size="xs">
        Sheet supports bottom (mobile / phone) and right (desktop peek) anchors. Right-anchored
        sheets render full-height at ~440px wide; size prop is ignored for
        `anchor=&quot;right&quot;`.
      </Text>
      <View className="flex-row gap-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>anchor=&quot;bottom&quot;</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="bottom" size="medium">
            <View className="flex-col gap-2">
              <Heading level={4}>Bottom anchor</Heading>
              <Text variant="muted" size="sm">
                Slides up from the bottom edge. Drag handle visible.
              </Text>
            </View>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>anchor=&quot;right&quot;</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="right">
            <View className="flex-col gap-2">
              <Heading level={4}>Right anchor</Heading>
              <Text variant="muted" size="sm">
                Slides in from the right edge. ~440px wide, full height. No drag handle (desktop
                usage).
              </Text>
            </View>
          </SheetContent>
        </Sheet>
      </View>
    </View>
  ),
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-col items-center gap-6 p-8">
      <Text variant="muted" size="xs">
        Three size tokens for bottom-anchored sheets — short ~33vh, medium ~60vh, tall ~95vh —
        mapped to typical content shapes per foundations/mobile/layout.md.
      </Text>
      <View className="flex-row gap-4">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>short</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="bottom" size="short">
            <View className="flex-col gap-2">
              <Heading level={4}>Short</Heading>
              <Text variant="muted" size="sm">
                ~33vh — best for flat lists of short labels (tab pickers, actions menus).
              </Text>
            </View>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>medium</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="bottom" size="medium">
            <View className="flex-col gap-2">
              <Heading level={4}>Medium</Heading>
              <Text variant="muted" size="sm">
                ~60vh — best for grouped or rich-row lists (model picker, calendar picker).
              </Text>
            </View>
          </SheetContent>
        </Sheet>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">
              <Text>tall</Text>
            </Button>
          </SheetTrigger>
          <SheetContent anchor="bottom" size="tall">
            <View className="flex-col gap-2">
              <Heading level={4}>Tall</Heading>
              <Text variant="muted" size="sm">
                ~95vh — best for rich detail (peek drawer, raw JSON viewer, settings detail panes).
              </Text>
            </View>
          </SheetContent>
        </Sheet>
      </View>
    </View>
  ),
}

// No ThemeMatrix story for Sheet: the sheet content portals to document
// body, which escapes the per-row `dataSet={{theme}}` scope used by
// other primitives' ThemeMatrix stories. Use the Storybook toolbar's
// global theme switcher to verify the open sheet's theming
// (one theme at a time), or visit the native dev page at /dev/sheet
// where the ThemePicker drives data-theme globally and portals
// inherit correctly.
