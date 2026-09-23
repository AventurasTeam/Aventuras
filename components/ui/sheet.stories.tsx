import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useState } from 'react'
import { View } from 'react-native'
import { expect, screen, userEvent } from 'storybook/test'

import { Button } from './button'
import { Heading } from './heading'
import { Input } from './input'
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
      <Sheet ariaLabel="Sheet">
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
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Open sheet' }))
    expect(await screen.findByRole('dialog', { name: 'Sheet' })).toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  },
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
        <Sheet ariaLabel="Bottom anchor">
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
        <Sheet ariaLabel="Right anchor">
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

// One dialog per sheet, named by the visible heading: gorhom (bottom) forwards no
// aria-labelledby, and Radix (right) wraps the content in a second dialog of its own.
function labelledSheet(anchor: 'bottom' | 'right'): Story {
  return {
    render: () => (
      <Sheet open onOpenChange={() => {}} ariaLabelledBy={`${anchor}-sheet-heading`}>
        <SheetContent anchor={anchor} size="short">
          <Heading level={3} nativeID={`${anchor}-sheet-heading`}>
            Scene
          </Heading>
        </SheetContent>
      </Sheet>
    ),
    play: async () => {
      expect(await screen.findByRole('dialog', { name: 'Scene' })).toBeVisible()
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
    },
  }
}

export const BottomNamedByHeading = labelledSheet('bottom')
export const RightNamedByHeading = labelledSheet('right')

function RerenderingRightSheet() {
  const [renders, setRenders] = useState(1)
  return (
    <Sheet open onOpenChange={() => {}} ariaLabel="Entity details">
      <SheetContent anchor="right">
        <Button onPress={() => setRenders((n) => n + 1)}>
          <Text>{`Rendered ${renders}×`}</Text>
        </Button>
      </SheetContent>
    </Sheet>
  )
}

// The right anchor strips Radix's wrapper once, on mount; a re-render must not bring it back.
export const RightStaysOneDialogAcrossRenders: Story = {
  render: () => <RerenderingRightSheet />,
  play: async () => {
    await userEvent.click(await screen.findByRole('button', { name: 'Rendered 1×' }))
    expect(await screen.findByRole('button', { name: 'Rendered 2×' })).toBeVisible()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Entity details' })).toBeVisible()
  },
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-col items-center gap-6 p-8">
      <Text variant="muted" size="xs">
        Three rigid size tokens for bottom-anchored sheets — short ~33vh, medium ~60vh, tall ~95vh —
        mapped to typical content shapes per foundations/mobile/layout.md. Use
        `size=&quot;auto&quot;` (separate story) for content-driven height.
      </Text>
      <View className="flex-row gap-4">
        <Sheet ariaLabel="Short sheet">
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
        <Sheet ariaLabel="Medium sheet">
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
        <Sheet ariaLabel="Tall sheet">
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

export const AutoSize: Story = {
  render: () => (
    <View className="items-center justify-center p-8">
      <Sheet ariaLabel="Confirm action">
        <SheetTrigger asChild>
          <Button>
            <Text>Open auto-sized sheet</Text>
          </Button>
        </SheetTrigger>
        <SheetContent anchor="bottom" size="auto">
          <View className="flex-col gap-3">
            <Heading level={4}>Auto-sized panel</Heading>
            <Text variant="muted" size="sm">
              size=&quot;auto&quot; lets short, content-driven sheets wrap their content with no
              dead space — gorhom applies no height cap by default, so keep auto-sized content
              intrinsically short.
            </Text>
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost">
                <Text>Cancel</Text>
              </Button>
              <Button>
                <Text>Confirm</Text>
              </Button>
            </View>
          </View>
        </SheetContent>
      </Sheet>
    </View>
  ),
}

export const WithInputInside: Story = {
  render: () => {
    const [value, setValue] = useState('')
    return (
      <View className="items-center justify-center p-8">
        <Sheet ariaLabel="Add note">
          <SheetTrigger asChild>
            <Button>
              <Text>Open sheet with input</Text>
            </Button>
          </SheetTrigger>
          <SheetContent size="auto">
            <View className="flex-col gap-3">
              <Heading level={3}>Add note</Heading>
              <Text variant="muted" size="sm">
                Input-bearing sheets use size=&quot;auto&quot; so the panel hugs its content and
                rises with the keyboard on native. Fixed-percentage sizes are for scrollable lists
                that adapt to available space. No-op on web.
              </Text>
              <Input value={value} onChangeText={setValue} placeholder="Type here…" />
            </View>
          </SheetContent>
        </Sheet>
      </View>
    )
  },
}

// No ThemeMatrix story for Sheet: the sheet content portals to document
// body, which escapes the per-row `dataSet={{theme}}` scope used by
// other primitives' ThemeMatrix stories. Use the Storybook toolbar's
// global theme switcher to verify the open sheet's theming
// (one theme at a time), or visit the native dev page at /dev/sheet
// where the ThemePicker drives data-theme globally and portals
// inherit correctly.
