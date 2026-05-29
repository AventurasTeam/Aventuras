import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { Text } from '@/components/ui/text'
import { themes } from '@/lib/themes'

import { CollisionListRow } from './collision-list-row'

const meta: Meta<typeof CollisionListRow> = {
  title: 'Compounds/CollisionListRow',
  component: CollisionListRow,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof CollisionListRow>

const baseRow = {
  label: 'Kael',
  description: 'A wandering swordsman.',
}

const baseCollision = {
  otherName: 'Kael',
  onJumpToOther: () => {},
  onResolve: () => {},
}

export const Default: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow row={baseRow} collision={baseCollision} />
    </View>
  ),
}

export const LongCollisionTarget: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={baseRow}
        collision={{
          ...baseCollision,
          otherName: 'Kael Vex of the Eastern Reaches',
        }}
      />
    </View>
  ),
}

export const WithKindIcon: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={{
          ...baseRow,
          leading: <EntityKindIcon kind="character" />,
        }}
        collision={baseCollision}
      />
    </View>
  ),
}

export const WithStatusPillSlot: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={{
          ...baseRow,
          leading: <EntityKindIcon kind="character" />,
          trailing: (
            <View className="rounded-sm bg-bg-sunken px-2 py-1">
              <Text size="xs" variant="muted">
                staged
              </Text>
            </View>
          ),
        }}
        collision={baseCollision}
      />
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="rounded-md bg-bg-base p-4"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm" className="mb-2">
            {t.name}
          </Text>
          <CollisionListRow row={baseRow} collision={baseCollision} />
        </View>
      ))}
    </View>
  ),
}
