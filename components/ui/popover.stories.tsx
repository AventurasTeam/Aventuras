import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, screen, userEvent } from 'storybook/test'

import { Button } from './button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog'
import { Heading } from './heading'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Text } from './text'

const meta: Meta<typeof Popover> = {
  title: 'Primitives/Popover',
  component: Popover,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Popover>

export const Default: Story = {
  render: () => (
    <View className="items-center justify-center p-8">
      <Popover ariaLabel="Popover heading">
        <PopoverTrigger asChild>
          <Button>
            <Text>Open popover</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          <View className="flex-col gap-2">
            <Heading level={4}>Popover heading</Heading>
            <Text variant="muted" size="sm">
              Anchored, content-sized, no scrim. Outside-click and Escape dismiss. State is
              uncontrolled — trigger toggles internally.
            </Text>
          </View>
        </PopoverContent>
      </Popover>
    </View>
  ),
}

export const Placements: Story = {
  render: () => (
    <View className="flex-col items-center gap-8 p-8">
      <Text variant="muted" size="xs">
        rn-primitives popover positions on the vertical axis only — side=&quot;top&quot; |
        &quot;bottom&quot; combined with align=&quot;start&quot; | &quot;center&quot; |
        &quot;end&quot;.
      </Text>
      <View className="flex-row flex-wrap items-center gap-4">
        <Popover ariaLabel="top start placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>top + start</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-48">
            <Text size="sm">side=&quot;top&quot; align=&quot;start&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover ariaLabel="top center placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>top + center</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-48">
            <Text size="sm">side=&quot;top&quot; align=&quot;center&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover ariaLabel="top end placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>top + end</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-48">
            <Text size="sm">side=&quot;top&quot; align=&quot;end&quot;</Text>
          </PopoverContent>
        </Popover>
      </View>
      <View className="flex-row flex-wrap items-center gap-4">
        <Popover ariaLabel="bottom start placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>bottom + start</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-48">
            <Text size="sm">side=&quot;bottom&quot; align=&quot;start&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover ariaLabel="bottom center placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>bottom + center</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="center" className="w-48">
            <Text size="sm">side=&quot;bottom&quot; align=&quot;center&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover ariaLabel="bottom end placement">
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>bottom + end</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="end" className="w-48">
            <Text size="sm">side=&quot;bottom&quot; align=&quot;end&quot;</Text>
          </PopoverContent>
        </Popover>
      </View>
    </View>
  ),
}

export const RichContent: Story = {
  render: () => (
    <View className="items-center justify-center p-8">
      <Popover ariaLabel="Settings">
        <PopoverTrigger asChild>
          <Button>
            <Text>Settings</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <View className="flex-col gap-3">
            <Heading level={3}>Settings</Heading>
            <Text variant="secondary" size="sm">
              Popovers can host arbitrary content — headings, body copy, form controls, action rows.
            </Text>
            <View className="mt-2 border-t border-border pt-3">
              <Button variant="ghost" size="sm">
                <Text>Action</Text>
              </Button>
            </View>
          </View>
        </PopoverContent>
      </Popover>
    </View>
  ),
}

export const Accessibility: Story = {
  render: () => (
    <View className="items-center justify-center p-8">
      <Popover ariaLabel="Account options" ariaDescribedBy="popover-a11y-desc">
        <PopoverTrigger asChild>
          <Button>
            <Text>Account</Text>
          </Button>
        </PopoverTrigger>
        <PopoverContent accessibilityRole="dialog">
          <View className="flex-col gap-2">
            <Heading level={4}>Account</Heading>
            <Text id="popover-a11y-desc" variant="muted" size="sm">
              The trigger advertises aria-haspopup; the content carries role=dialog plus an
              accessible name and description. Inspect the accessibility tree to verify.
            </Text>
          </View>
        </PopoverContent>
      </Popover>
    </View>
  ),
}

// No ThemeMatrix story for Popover: the popover content portals to
// document body, which escapes the per-row `dataSet={{theme}}` scope
// used by other primitives' ThemeMatrix stories. Use the Storybook
// toolbar's global theme switcher to verify the open popover's theming
// (one theme at a time), or visit the native dev page at /dev/popover
// where the ThemePicker drives data-theme globally and portals
// inherit correctly.

// layout.md → Stacking: "Popover over anything — they fire over a Sheet or Modal
// when their trigger is visible." At the Dialog's own z-50 a popover ties with the
// modal it was opened from and loses on paint order, which is how the scene editor's
// multi-select ended up rendering behind its own dialog.
export const OverAModal: Story = {
  render: () => (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Host modal</DialogTitle>
        </DialogHeader>
        <Popover ariaLabel="Nested popover">
          <PopoverTrigger asChild>
            <Button>
              <Text>Open popover</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <Text>Above the modal</Text>
          </PopoverContent>
        </Popover>
      </DialogContent>
    </Dialog>
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Open popover' }))
    const content = await screen.findByText('Above the modal')

    // Occlusion, not z-index values: the popover was once trapped in a stacking
    // context whose own z-index capped it below the dialog, so every element in the
    // subtree still reported a winning z-index while painting underneath. Hit-testing
    // the rendered pixel is the only assertion that catches that.
    const box = content.getBoundingClientRect()
    const topMost = document.elementFromPoint(
      Math.floor(box.left + box.width / 2),
      Math.floor(box.top + box.height / 2),
    )
    expect(topMost).not.toBeNull()
    expect(content.contains(topMost) || content === topMost).toBe(true)
  },
}
