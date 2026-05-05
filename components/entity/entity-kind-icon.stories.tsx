import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import * as React from 'react'
import { View } from 'react-native'
import { expect, screen } from 'storybook/test'

import { Text, TextClassContext } from '@/components/ui/text'
import { themes } from '@/lib/themes/registry'

import { EntityKindIcon, type EntityKind } from './entity-kind-icon'

const meta: Meta<typeof EntityKindIcon> = {
  title: 'Compounds/Entity/EntityKindIcon',
  component: EntityKindIcon,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof EntityKindIcon>

const KINDS: EntityKind[] = ['character', 'location', 'item', 'faction']

/**
 * All four kinds side-by-side. The 22×22 wrapper is a fixed box —
 * inner glyph (Lucide, 16 px) is centered.
 */
export const AllKinds: Story = {
  render: () => (
    <View className="flex-row gap-3">
      {KINDS.map((kind) => (
        <View key={kind} className="items-center gap-1">
          <EntityKindIcon kind={kind} />
          <Text size="xs" variant="muted">
            {kind}
          </Text>
        </View>
      ))}
    </View>
  ),
}

/**
 * Color inheritance via `TextClassContext`. Wrapping in a context
 * with `text-fg-muted` paints the glyphs muted; with `text-accent`
 * paints them accent. Same component, no per-icon prop needed.
 */
export const ColorInheritance: Story = {
  render: () => (
    <View className="flex-col gap-4">
      <View className="gap-1">
        <Text size="xs" variant="muted">
          default (inherits page text color)
        </Text>
        <View className="flex-row gap-3">
          {KINDS.map((kind) => (
            <EntityKindIcon key={kind} kind={kind} />
          ))}
        </View>
      </View>
      <View className="gap-1">
        <Text size="xs" variant="muted">
          inside `text-fg-muted` context
        </Text>
        <TextClassContext.Provider value="text-fg-muted">
          <View className="flex-row gap-3">
            {KINDS.map((kind) => (
              <EntityKindIcon key={kind} kind={kind} />
            ))}
          </View>
        </TextClassContext.Provider>
      </View>
      <View className="gap-1">
        <Text size="xs" variant="muted">
          inside `text-accent` context
        </Text>
        <TextClassContext.Provider value="text-accent">
          <View className="flex-row gap-3">
            {KINDS.map((kind) => (
              <EntityKindIcon key={kind} kind={kind} />
            ))}
          </View>
        </TextClassContext.Provider>
      </View>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-3">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only; not in RN's View type.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-3"
          style={{ width: 360 }}
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-row gap-3">
            {KINDS.map((kind) => (
              <EntityKindIcon key={kind} kind={kind} />
            ))}
          </View>
        </View>
      ))}
    </View>
  ),
}

/**
 * Each glyph carries an aria-label matching its kind, so screen
 * readers announce "character", "location", etc. The image role
 * lets assistive tech treat it as a single nameable element.
 */
export const AccessibilityLabel: Story = {
  render: () => <EntityKindIcon kind="character" />,
  play: async () => {
    expect(screen.getByLabelText('character')).toBeInTheDocument()
  },
}
