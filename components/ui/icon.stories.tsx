import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Flag,
  GitBranch,
  MapPin,
  MoreHorizontal,
  MoreVertical,
  Package,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Settings,
  SlidersVertical,
  Star,
  Trash2,
  User,
  X,
} from 'lucide-react-native'
import * as React from 'react'
import { View } from 'react-native'

import { Icon } from './icon'
import { Text } from './text'
import { themes } from '@/lib/themes/registry'

const meta: Meta<typeof Icon> = {
  title: 'Primitives/Icon',
  component: Icon,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
}

export default meta
type Story = StoryObj<typeof Icon>

export const Default: Story = {
  args: { as: Settings },
}

export const Sizes: Story = {
  render: () => (
    <View className="flex-row items-end gap-6">
      <View className="items-center gap-1">
        <Icon as={Settings} size="sm" />
        <Text variant="muted" size="sm">
          sm · 16
        </Text>
      </View>
      <View className="items-center gap-1">
        <Icon as={Settings} size="md" />
        <Text variant="muted" size="sm">
          md · 20
        </Text>
      </View>
      <View className="items-center gap-1">
        <Icon as={Settings} size="lg" />
        <Text variant="muted" size="sm">
          lg · 24
        </Text>
      </View>
    </View>
  ),
}

const VOCAB_GROUPS: { title: string; items: { icon: typeof Settings; label: string }[] }[] = [
  {
    title: 'Top-bar / chrome',
    items: [
      { icon: Settings, label: 'Settings' },
      { icon: SlidersVertical, label: 'SlidersVertical' },
      { icon: MoreVertical, label: 'MoreVertical' },
      { icon: ArrowLeft, label: 'ArrowLeft' },
      { icon: GitBranch, label: 'GitBranch' },
      { icon: MoreHorizontal, label: 'MoreHorizontal' },
    ],
  },
  {
    title: 'Directional',
    items: [
      { icon: ArrowRight, label: 'ArrowRight' },
      { icon: ChevronDown, label: 'ChevronDown' },
      { icon: ChevronRight, label: 'ChevronRight' },
    ],
  },
  {
    title: 'Status',
    items: [
      { icon: AlertTriangle, label: 'AlertTriangle' },
      { icon: Check, label: 'Check' },
      { icon: X, label: 'X' },
      { icon: Star, label: 'Star' },
      { icon: Brain, label: 'Brain' },
    ],
  },
  {
    title: 'Per-entry actions',
    items: [
      { icon: Pencil, label: 'Pencil' },
      { icon: RotateCw, label: 'RotateCw' },
      { icon: Trash2, label: 'Trash2' },
    ],
  },
  {
    title: 'Entity kinds',
    items: [
      { icon: User, label: 'User' },
      { icon: MapPin, label: 'MapPin' },
      { icon: Package, label: 'Package' },
      { icon: Flag, label: 'Flag' },
    ],
  },
  {
    title: 'Common UI',
    items: [
      { icon: Search, label: 'Search' },
      { icon: Plus, label: 'Plus' },
      { icon: Filter, label: 'Filter' },
      { icon: Clock, label: 'Clock' },
    ],
  },
]

export const Vocabulary: Story = {
  render: () => (
    <View className="flex-col gap-4">
      {VOCAB_GROUPS.map((group) => (
        <View key={group.title} className="gap-2">
          <Text variant="muted" size="sm">
            {group.title}
          </Text>
          <View className="flex-row flex-wrap gap-4">
            {group.items.map(({ icon, label }) => (
              <View key={label} className="w-24 items-center gap-1">
                <Icon as={icon} size="md" />
                <Text size="sm">{label}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  ),
}

export const ColorInheritance: Story = {
  render: () => (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        <Icon as={Star} />
        <Text>Default — text-fg-primary</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <Icon as={Star} className="text-fg-muted" />
        <Text variant="muted">Muted — text-fg-muted at use site</Text>
      </View>
      {/* Inheriting the surrounding Text color via TextClassContext. */}
      <Text variant="muted">
        <View className="flex-row items-center gap-2">
          <Icon as={Star} />
          <Text>Inherited from muted Text wrapper</Text>
        </View>
      </Text>
      <View className="flex-row items-center gap-2">
        <Icon as={AlertTriangle} className="text-danger" />
        <Text className="text-danger">Danger — text-danger</Text>
      </View>
    </View>
  ),
}

export const ThemeMatrix: Story = {
  render: () => (
    <View className="flex-col gap-4">
      {themes.map((t) => (
        <View
          key={t.id}
          // @ts-expect-error — dataSet is RN-Web only.
          dataSet={{ theme: t.id }}
          className="flex-col gap-2 rounded-md bg-bg-base p-4"
        >
          <Text variant="muted" size="sm">
            {t.name}
          </Text>
          <View className="flex-row items-center gap-4">
            <Icon as={Settings} size="sm" />
            <Icon as={Settings} size="md" />
            <Icon as={Settings} size="lg" />
            <Icon as={GitBranch} className="text-fg-muted" />
            <Icon as={AlertTriangle} className="text-danger" />
            <Icon as={Check} className="text-success" />
          </View>
        </View>
      ))}
    </View>
  ),
}
