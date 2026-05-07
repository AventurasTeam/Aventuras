import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { DeltaLogRow, type Delta } from '@/components/compounds/delta-log-row'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

const SAMPLE_DELTAS: readonly Delta[] = [
  {
    id: '1',
    op: 'create',
    source: 'ai_classifier',
    targetTable: 'entities',
    targetDisplayName: 'Mira',
    fieldPath: null,
    summary: 'Created',
    entryId: 'entry #12',
    createdAtRelative: '5m ago',
    actionId: 'a1',
  },
  {
    id: '2',
    op: 'update',
    source: 'ai_classifier',
    targetTable: 'entities',
    targetDisplayName: 'Kael',
    fieldPath: 'state.traits',
    summary: 'Added "former soldier"; was ["brave", "loyal"]',
    entryId: 'entry #47',
    createdAtRelative: '2h ago',
    actionId: 'a2',
  },
  {
    id: '3',
    op: 'update',
    source: 'user_edit',
    targetTable: 'entities',
    targetDisplayName: 'Mira',
    fieldPath: 'description',
    summary: 'Updated description',
    entryId: null,
    createdAtRelative: '3h ago',
    actionId: 'a3',
  },
  {
    id: '4',
    op: 'update',
    source: 'lore_agent',
    targetTable: 'lore',
    targetDisplayName: 'The Iron Pact',
    fieldPath: 'state.faction_membership',
    summary: 'Mira added as a member; was ["Kael", "Joren"]',
    entryId: 'entry #46',
    createdAtRelative: '4h ago',
    actionId: 'a4',
  },
  {
    id: '5',
    op: 'delete',
    source: 'user_edit',
    targetTable: 'threads',
    targetDisplayName: 'Subplot — barkeeper feud',
    fieldPath: null,
    summary: 'Deleted',
    entryId: null,
    createdAtRelative: '1d ago',
    actionId: 'a5',
  },
  {
    id: '6',
    op: 'update',
    source: 'memory_compaction',
    targetTable: 'entries',
    targetDisplayName: 'Branch — main',
    fieldPath: 'memory.long_term',
    summary: 'Compacted 12 entries into long-term memory',
    entryId: null,
    createdAtRelative: '2d ago',
    actionId: 'a6',
  },
  {
    id: '7',
    op: 'create',
    source: 'chapter_close',
    targetTable: 'chapters',
    targetDisplayName: 'Chapter 3',
    fieldPath: null,
    summary: 'Chapter closed; world snapshot taken',
    entryId: null,
    createdAtRelative: '3d ago',
    actionId: 'a7',
  },
]

const LONG_DELTA: Delta = {
  id: 'long',
  op: 'update',
  source: 'ai_classifier',
  targetTable: 'entities',
  targetDisplayName: 'A character with an unusually long display name that should truncate inline',
  fieldPath: 'state.relationships.factions[2].standing',
  summary:
    'A long summary that should clamp to two lines and ellipsize cleanly. The host format covers the diff so the row can leave overflow rendering to the layout layer; consumers should expect the bound at exactly two lines so the meta strip keeps its baseline.',
  entryId: 'entry #47',
  createdAtRelative: '2h ago',
  actionId: 'a-long',
}

export default function DeltaLogRowDevRoute() {
  const [pressed, setPressed] = React.useState<string | null>(null)

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-10 p-4">
        <View className="gap-3">
          <Heading level={2}>History tab — interactive list</Heading>
          <Text size="sm" variant="muted">
            Mixed ops, sources, with-and-without entry links. Tap any row.
          </Text>
          {pressed != null ? (
            <Text size="xs" variant="muted">
              Last pressed: {pressed}
            </Text>
          ) : null}
          <View className="rounded-md border border-border">
            {SAMPLE_DELTAS.map((d) => (
              <DeltaLogRow key={d.id} delta={d} onPress={() => setPressed(d.id)} />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Truncation — long target + summary</Heading>
          <Text size="sm" variant="muted">
            Target name truncates inline; summary clamps at 2 lines.
          </Text>
          <View className="rounded-md border border-border">
            <DeltaLogRow delta={LONG_DELTA} onPress={() => {}} />
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Non-interactive variant</Heading>
          <Text size="sm" variant="muted">
            No <Text className="font-mono">onPress</Text> — no hover, no press affordance, no button
            role.
          </Text>
          <View className="rounded-md border border-border">
            <DeltaLogRow delta={SAMPLE_DELTAS[1]!} />
          </View>
        </View>

        <View className="gap-3">
          <Heading level={2}>Op color spread</Heading>
          <View className="rounded-md border border-border">
            {(['create', 'update', 'delete'] as const).map((op) => (
              <DeltaLogRow
                key={op}
                delta={{
                  ...SAMPLE_DELTAS[1]!,
                  id: `op-${op}`,
                  op,
                  fieldPath: op === 'update' ? 'state.traits' : null,
                  summary:
                    op === 'update'
                      ? 'Added "former soldier"'
                      : op === 'create'
                        ? 'Created'
                        : 'Deleted',
                }}
                onPress={() => {}}
              />
            ))}
          </View>
        </View>
      </View>
    </ScrollView>
  )
}
