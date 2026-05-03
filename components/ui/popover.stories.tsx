import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { Button } from './button'
import { Heading } from './heading'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

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
      <Popover>
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>top + start</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-48">
            <Text size="sm">side=&quot;top&quot; align=&quot;start&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>top + center</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-48">
            <Text size="sm">side=&quot;top&quot; align=&quot;center&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover>
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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>bottom + start</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-48">
            <Text size="sm">side=&quot;bottom&quot; align=&quot;start&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">
              <Text>bottom + center</Text>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="center" className="w-48">
            <Text size="sm">side=&quot;bottom&quot; align=&quot;center&quot;</Text>
          </PopoverContent>
        </Popover>
        <Popover>
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
      <Popover>
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

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-6">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col items-start gap-3 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="xs">
            {t.name}
          </Text>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">
                <Text>Open popover</Text>
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" className="w-64">
              <View className="flex-col gap-1">
                <Heading level={5}>{t.name}</Heading>
                <Text variant="muted" size="sm">
                  bg-overlay surface, border slot, fg-primary text.
                </Text>
              </View>
            </PopoverContent>
          </Popover>
        </View>
      ))}
    </View>
  ),
}
