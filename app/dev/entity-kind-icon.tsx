import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { EntityKindIcon, type EntityKind } from '@/components/entity/entity-kind-icon'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text, TextClassContext } from '@/components/ui/text'

const KINDS: EntityKind[] = ['character', 'location', 'item', 'faction']

export default function EntityKindIconDevRoute() {
  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-3">
          <Heading level={2}>All four kinds</Heading>
          <Text size="sm" variant="muted">
            22×22 box, 16 px glyph centered. Pinned to the canonical Lucide table in iconography.md
            — character, location, item, faction.
          </Text>
          <View className="flex-row gap-4">
            {KINDS.map((kind) => (
              <View key={kind} className="items-center gap-1">
                <EntityKindIcon kind={kind} />
                <Text size="xs" variant="muted">
                  {kind}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Color inheritance</Heading>
          <Text size="sm" variant="muted">
            No `color` prop — the inner Icon reads `TextClassContext`. A row that paints its label
            `text-fg-muted` paints the kind icon to match without per-icon plumbing.
          </Text>
          <View className="gap-3">
            <View className="gap-1">
              <Text size="xs" variant="muted">
                default
              </Text>
              <View className="flex-row gap-3">
                {KINDS.map((k) => (
                  <EntityKindIcon key={k} kind={k} />
                ))}
              </View>
            </View>
            <View className="gap-1">
              <Text size="xs" variant="muted">
                text-fg-muted
              </Text>
              <TextClassContext.Provider value="text-fg-muted">
                <View className="flex-row gap-3">
                  {KINDS.map((k) => (
                    <EntityKindIcon key={k} kind={k} />
                  ))}
                </View>
              </TextClassContext.Provider>
            </View>
            <View className="gap-1">
              <Text size="xs" variant="muted">
                text-accent
              </Text>
              <TextClassContext.Provider value="text-accent">
                <View className="flex-row gap-3">
                  {KINDS.map((k) => (
                    <EntityKindIcon key={k} kind={k} />
                  ))}
                </View>
              </TextClassContext.Provider>
            </View>
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>In a row</Heading>
          <Text size="sm" variant="muted">
            Inline alongside text — the box keeps a stable column on the leading edge.
          </Text>
          <View className="gap-2">
            {KINDS.map((kind) => (
              <View key={kind} className="flex-row items-center gap-2 rounded-md bg-bg-raised p-3">
                <EntityKindIcon kind={kind} />
                <Text className="font-medium">Sample {kind}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
