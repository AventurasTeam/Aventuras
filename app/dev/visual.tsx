import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Flag,
  GitBranch,
  MapPin,
  MoreVertical,
  Package,
  Pencil,
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
import { ScrollView, View } from 'react-native'

import { DensityPicker } from '@/components/foundations/sections/density-picker'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Avatar } from '@/components/ui/avatar'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'

const SAMPLE_IMAGE = 'https://i.pravatar.cc/300'

export default function VisualDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <DensityPicker />
      <View className="gap-6 p-4">
        <View className="gap-2">
          <Heading level={2}>Icon — sizes</Heading>
          <Text size="sm" variant="muted">
            sm · 16, md · 20 (default), lg · 24. All locked at 2 px stroke.
          </Text>
          <View className="flex-row items-end gap-6">
            <View className="items-center gap-1">
              <Icon as={Settings} size="sm" />
              <Text variant="muted" size="sm">
                sm
              </Text>
            </View>
            <View className="items-center gap-1">
              <Icon as={Settings} size="md" />
              <Text variant="muted" size="sm">
                md
              </Text>
            </View>
            <View className="items-center gap-1">
              <Icon as={Settings} size="lg" />
              <Text variant="muted" size="sm">
                lg
              </Text>
            </View>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Icon — color inheritance</Heading>
          <Text size="sm" variant="muted">
            cssInterop pipes style.color → lucide&apos;s color prop on native.
          </Text>
          <View className="gap-2">
            <View className="flex-row items-center gap-2">
              <Icon as={Star} />
              <Text>Default · text-fg-primary</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon as={Star} className="text-fg-muted" />
              <Text variant="muted">text-fg-muted</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon as={AlertTriangle} className="text-danger" />
              <Text className="text-danger">text-danger</Text>
            </View>
            <View className="flex-row items-center gap-2">
              <Icon as={Check} className="text-success" />
              <Text className="text-success">text-success</Text>
            </View>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Icon — vocabulary sample</Heading>
          <View className="flex-row flex-wrap gap-4">
            {[
              { icon: Settings, label: 'Settings' },
              { icon: SlidersVertical, label: 'Sliders' },
              { icon: MoreVertical, label: 'More' },
              { icon: ArrowLeft, label: 'Back' },
              { icon: GitBranch, label: 'Branch' },
              { icon: ChevronDown, label: 'Caret' },
              { icon: Search, label: 'Search' },
              { icon: Pencil, label: 'Edit' },
              { icon: RotateCw, label: 'Regen' },
              { icon: Trash2, label: 'Delete' },
              { icon: X, label: 'Close' },
              { icon: Star, label: 'Lead' },
              { icon: User, label: 'Char' },
              { icon: MapPin, label: 'Loc' },
              { icon: Package, label: 'Item' },
              { icon: Flag, label: 'Faction' },
            ].map(({ icon, label }) => (
              <View key={label} className="w-20 items-center gap-1">
                <Icon as={icon} size="md" />
                <Text size="sm">{label}</Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Avatar — sizes</Heading>
          <Text size="sm" variant="muted">
            xs · 24, sm · 40, md · 96, lg · 220 — tied to v1 wireframe sites.
          </Text>
          <View className="flex-row items-end gap-4">
            <View className="items-center gap-1">
              <Avatar size="xs" alt="xs" fallback="X" />
              <Text variant="muted" size="sm">
                xs
              </Text>
            </View>
            <View className="items-center gap-1">
              <Avatar size="sm" alt="sm" fallback="SM" />
              <Text variant="muted" size="sm">
                sm
              </Text>
            </View>
            <View className="items-center gap-1">
              <Avatar size="md" alt="md" fallback="MD" />
              <Text variant="muted" size="sm">
                md
              </Text>
            </View>
          </View>
          <View className="items-center gap-1">
            <Avatar size="lg" alt="lg" fallback="LG" />
            <Text variant="muted" size="sm">
              lg · 220
            </Text>
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Avatar — image with fallback</Heading>
          <View className="flex-row items-center gap-3">
            <Avatar size="sm" alt="Daisy" src={SAMPLE_IMAGE} fallback="DV" />
            <Avatar size="md" alt="Daisy" src={SAMPLE_IMAGE} fallback="DV" />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Avatar — entity-kind glyphs</Heading>
          <Text size="sm" variant="muted">
            Icon-as-fallback inherits text-fg-secondary from Avatar&apos;s context.
          </Text>
          <View className="flex-row items-center gap-3">
            <Avatar size="sm" alt="Character" fallback={<Icon as={User} size="md" />} />
            <Avatar size="sm" alt="Location" fallback={<Icon as={MapPin} size="md" />} />
            <Avatar size="sm" alt="Item" fallback={<Icon as={Package} size="md" />} />
            <Avatar size="sm" alt="Faction" fallback={<Icon as={Flag} size="md" />} />
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Avatar — empty placeholder</Heading>
          <View className="flex-row items-center gap-3">
            <Avatar size="xs" alt="empty" />
            <Avatar size="sm" alt="empty" />
            <Avatar size="md" alt="empty" />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
