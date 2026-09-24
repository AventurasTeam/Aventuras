import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ListRow } from '@/components/compounds/list-row'
import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'

type Row = {
  id: string
  label: string
  description?: string
  kind?: 'character' | 'location' | 'item' | 'faction'
  status: string
  isLead?: boolean
  inScene?: boolean
  recently?: 'fresh' | 'fading'
}

const ROWS: Row[] = [
  {
    id: 'aiko',
    label: 'Aiko',
    kind: 'character',
    status: 'active',
    isLead: true,
    inScene: true,
  },
  {
    id: 'reiko',
    label: 'Reiko',
    kind: 'character',
    status: 'active',
    inScene: true,
  },
  {
    id: 'hamasaki',
    label: 'Lord Hamasaki',
    kind: 'character',
    status: 'staged',
    recently: 'fresh',
  },
  {
    id: 'kuratomi',
    label: 'Kuratomi Castle',
    kind: 'location',
    status: 'active',
  },
  {
    id: 'tea-set',
    label: 'Lacquered tea set',
    kind: 'item',
    status: 'staged',
    recently: 'fading',
  },
  {
    id: 'shogun-faction',
    label: 'Tokugawa Shogunate',
    kind: 'faction',
    status: 'active',
  },
  {
    id: 'thread-courier',
    label: "The Empress's missing courier",
    description: 'Long-running thread spanning chapters 3–7.',
    status: 'active',
  },
  {
    id: 'yumi',
    label: 'Yumi',
    kind: 'character',
    status: 'retired',
  },
]

export default function ListRowDevRoute() {
  const [selectedId, setSelectedId] = useState<string>('aiko')

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-2">
          <Heading level={2}>List pane (selectable)</Heading>
          <Text size="sm" variant="muted">
            Tap a row to select it. The selected row picks up the depressed-surface tint
            (`bg-bg-sunken`); recently-classified rows outrank selection visually so a fresh tint
            stays visible even when also selected.
          </Text>
          <View className="rounded-md border border-border bg-bg-base">
            {ROWS.map((row) => (
              <ListRow
                key={row.id}
                label={row.label}
                description={row.description}
                leading={row.kind != null ? <EntityKindIcon kind={row.kind} /> : null}
                meta={row.isLead ? <Tag>You</Tag> : null}
                trailing={<Tag>{row.status}</Tag>}
                inScene={row.inScene}
                recentlyClassified={row.recently}
                selected={selectedId === row.id}
                onPress={() => setSelectedId(row.id)}
              />
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Channel matrix</Heading>
          <Text size="sm" variant="muted">
            Each combination of `inScene` × `recentlyClassified` rendered side by side. The two
            channels are orthogonal — left-edge stripe (scene-presence) and background tint
            (recently-classified) never contest each other.
          </Text>
          <View className="gap-2">
            {(
              [
                { label: 'plain', inScene: false, recently: undefined },
                { label: 'in-scene only', inScene: true, recently: undefined },
                {
                  label: 'recently-classified fresh only',
                  inScene: false,
                  recently: 'fresh' as const,
                },
                {
                  label: 'recently-classified fading only',
                  inScene: false,
                  recently: 'fading' as const,
                },
                {
                  label: 'in-scene + recently-classified fresh',
                  inScene: true,
                  recently: 'fresh' as const,
                },
              ] as const
            ).map((c, i) => (
              <View
                key={i}
                className="rounded-md border border-border bg-bg-base"
                style={{ width: 380 }}
              >
                <ListRow
                  label={c.label}
                  leading={<EntityKindIcon kind="character" />}
                  trailing={<Tag>active</Tag>}
                  inScene={c.inScene}
                  recentlyClassified={c.recently}
                  onPress={() => {}}
                />
              </View>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Heading level={2}>Disabled</Heading>
          <Text size="sm" variant="muted">
            Disabled rows drop the button role entirely — no press, no hover, opacity-50. Use for
            retired entries that shouldn&apos;t be navigable.
          </Text>
          <View className="rounded-md border border-border bg-bg-base" style={{ width: 380 }}>
            <ListRow
              label="Yumi (retired)"
              leading={<EntityKindIcon kind="character" />}
              trailing={<Tag>retired</Tag>}
              disabled
              onPress={() => {}}
            />
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
