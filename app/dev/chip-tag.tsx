import * as React from 'react'
import { ScrollView, View } from 'react-native'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'

export default function ChipTagDevRoute() {
  const [activeFilter, setActiveFilter] = React.useState('all')
  const [tags, setTags] = React.useState(['fantasy', 'high-magic', 'ensemble'])
  const filters = [
    { id: 'all', label: 'All' },
    { id: 'in-scene', label: 'In scene' },
    { id: 'active', label: 'Active' },
    { id: 'staged', label: 'Staged' },
    { id: 'retired', label: 'Retired' },
  ]
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-6 p-4">
        <View>
          <Heading level={3}>Chip — filter row</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Square (4px radius), toggleable. Filled+inverted on selected.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {filters.map((f) => (
              <Chip
                key={f.id}
                selected={activeFilter === f.id}
                onPress={() => setActiveFilter(f.id)}
              >
                {f.label}
              </Chip>
            ))}
          </View>
        </View>

        <View>
          <Heading level={3}>Chip — static + disabled</Heading>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Chip>read-only</Chip>
            <Chip selected>active state</Chip>
            <Chip disabled onPress={() => {}}>
              Disabled, off
            </Chip>
            <Chip disabled selected onPress={() => {}}>
              Disabled, on
            </Chip>
          </View>
        </View>

        <View>
          <Heading level={3}>Tag — static</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Pill (full radius), labeled content.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Tag>tag-name</Tag>
            <Tag>another</Tag>
            <Tag>multi-word tag</Tag>
          </View>
        </View>

        <View>
          <Heading level={3}>Tag — removable</Heading>
          <Text variant="muted" size="xs" className="mt-1">
            Tap × to remove.
          </Text>
          <View className="mt-3 flex-row flex-wrap gap-2">
            {tags.map((t) => (
              <Tag
                key={t}
                removable
                onRemove={() => setTags((prev) => prev.filter((x) => x !== t))}
              >
                {t}
              </Tag>
            ))}
            {tags.length === 0 ? (
              <Text variant="muted" size="sm">
                (all removed)
              </Text>
            ) : null}
          </View>
        </View>

        <View>
          <Heading level={3}>Tag — soft tone (entity refs)</Heading>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Tag tone="soft">@kael</Tag>
            <Tag tone="soft">@elara</Tag>
            <Tag tone="soft" onPress={() => {}}>
              @darius (clickable)
            </Tag>
          </View>
        </View>

        <View>
          <Heading level={3}>Tag — add affordance + mixed</Heading>
          <View className="mt-3 flex-row flex-wrap gap-2">
            <Tag tone="soft">@kael</Tag>
            <Tag>fantasy</Tag>
            <Tag removable onRemove={() => {}}>
              ensemble
            </Tag>
            <Tag dashed onPress={() => {}}>
              + tag
            </Tag>
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
