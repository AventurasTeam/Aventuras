import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { View } from 'react-native'
import { expect, fn, screen, userEvent } from 'storybook/test'

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
  onJumpToOther: fn(),
  onResolve: fn(),
}

export const Default: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow row={baseRow} collision={baseCollision} />
    </View>
  ),
  play: async () => {
    // A standing state, not an event: a named group, never an assertive alert.
    expect(screen.getByRole('group', { name: 'Collision warning' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
    const resolveButton = screen.getByRole('button', { name: 'Resolve →' })
    await userEvent.click(resolveButton)
    expect(baseCollision.onResolve).toHaveBeenCalledTimes(1)
  },
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

/** Resolve stays visible but inert, with its reason as the tooltip. */
export const ResolveDisabledWithReason: Story = {
  render: () => (
    <View style={{ width: 360 }}>
      <CollisionListRow
        row={baseRow}
        collision={{
          otherName: baseCollision.otherName,
          onJumpToOther: baseCollision.onJumpToOther,
          resolveDisabledReason: 'Lands in Slice 4.2c',
        }}
      />
    </View>
  ),
  play: async () => {
    expect(screen.getByTitle('Lands in Slice 4.2c')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '⚠ Collides with Kael' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve →' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}
