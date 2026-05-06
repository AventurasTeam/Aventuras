import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { JSONViewer } from '@/components/compounds/json-viewer'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

const ENTITY = {
  id: 'ent_01HXYZ',
  kind: 'character',
  name: 'Mira',
  state: {
    description: 'Apprentice swordsmith haunted by an unfinished blade.',
    visual: { hair: 'Black, shoulder-length, often pinned back.' },
    traits: ['Patient', 'Anxious in crowds', 'Fluent in Old Yamato'],
  },
  awareness: { knowsAbout: ['ent_02ABC', 'ent_03DEF'] },
  classified_at: '2026-04-30T11:42:01Z',
}

const HAPPENING = {
  id: 'hap_03QWE',
  thread_id: 'thr_01ASD',
  summary: 'Mira tests the new blade in the courtyard.',
  involvements: [
    { entity_id: 'ent_01HXYZ', role: 'actor' },
    { entity_id: 'ent_02ABC', role: 'observer' },
  ],
  awareness_summary: { discovered: [], reinforced: ['ent_02ABC'] },
}

const STORY_BACKUP = {
  story_id: 'stry_01',
  seed: 'A long-running serial about a quiet swordsmith.',
  entries: Array.from({ length: 80 }, (_, i) => ({
    id: `ent_${String(i).padStart(3, '0')}`,
    ts: `2026-04-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z`,
    text: `Entry ${i + 1} — short narration line for scroll testing.`,
  })),
}

type Sample = { label: string; name: string; data: unknown }

const SAMPLES: readonly Sample[] = [
  { label: 'Entity', name: 'Mira (character)', data: ENTITY },
  { label: 'Happening', name: 'hap_03QWE — courtyard test', data: HAPPENING },
  { label: 'Empty', name: 'empty.json', data: {} },
  {
    label: 'Long name',
    name: 'A character with a comically long name that exceeds the drawer width comfortably',
    data: ENTITY,
  },
  { label: 'Large blob', name: 'story export', data: STORY_BACKUP },
] as const

export default function JSONViewerDevRoute() {
  const [open, setOpen] = React.useState(false)
  const [sample, setSample] = React.useState<Sample>(SAMPLES[0])

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-3">
          <Heading level={2}>JSON viewer drawer</Heading>
          <Text size="sm" variant="muted">
            Right-anchored drawer for the shared `View raw JSON` affordance. Pick a shape, press
            View — the drawer mounts on open and unmounts on close. Esc / overlay / × all dismiss.
          </Text>

          <View className="flex-row flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <Button
                key={s.label}
                variant={s.label === sample.label ? 'primary' : 'secondary'}
                size="sm"
                onPress={() => setSample(s)}
              >
                <Text>{s.label}</Text>
              </Button>
            ))}
          </View>

          <View className="flex-row gap-2">
            <Button onPress={() => setOpen(true)}>
              <Text>View raw JSON</Text>
            </Button>
            <Text variant="muted" size="xs" className="self-center">
              Active sample: {sample.label}
            </Text>
          </View>
        </View>
      </View>

      <JSONViewer open={open} onOpenChange={setOpen} name={sample.name} data={sample.data} />
    </ScrollView>
  )
}
