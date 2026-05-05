import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Autocomplete } from '@/components/ui/autocomplete'
import { Chip } from '@/components/ui/chip'
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'

const ERA_NAMES = [
  'Reiwa',
  'Heisei',
  'Showa',
  'Taisho',
  'Meiji',
  'Keio',
  'Genji',
  'Bunkyu',
  'Manen',
  'Ansei',
  'Kaei',
  'Koka',
  'Tenpo',
  'Bunsei',
  'Bunka',
  'Kyowa',
  'Kansei',
  'Tenmei',
  "An'ei",
  'Meiwa',
  'Horeki',
  "Kan'en",
  'Enkyo',
  'Kanpo',
  'Genbun',
  'Kyoho',
  'Shotoku',
  'Hoei',
  'Genroku',
  'Jokyo',
  'Tenna',
  'Empo',
  'Kanbun',
  'Manji',
  'Meireki',
  'Joo',
  'Keian',
  'Shoho',
  "Kan'ei",
  'Genna',
  'Keicho',
] as const

// Small word pools combined with a zero-padded index produce
// deterministic synthetic labels with varied lengths — long enough
// to exercise `measureElement`'s variable-row-height path on web,
// short enough that a name doesn't wrap unless the popover is
// narrow. Pool size (8 × 8 = 64) ensures any prefix substring like
// "ver" matches a non-trivial filter result.
const STRESS_ADJECTIVES = [
  'Aurora',
  'Verdant',
  'Crimson',
  'Lattice',
  'Sable',
  'Halcyon',
  'Argent',
  'Ember',
] as const
const STRESS_NOUNS = [
  'Lighthouse',
  'Anchor',
  'Beacon',
  'Cipher',
  'Glade',
  'Marrow',
  'Reverie',
  'Threshold',
] as const

function generateStressEntries(count: number): string[] {
  const out: string[] = new Array(count)
  const pad = String(count).length
  for (let i = 0; i < count; i++) {
    const adj = STRESS_ADJECTIVES[i % STRESS_ADJECTIVES.length]!
    const noun = STRESS_NOUNS[Math.floor(i / STRESS_ADJECTIVES.length) % STRESS_NOUNS.length]!
    out[i] = `${adj} ${noun} ${String(i + 1).padStart(pad, '0')}`
  }
  return out
}

const STRESS_COUNTS = [100, 1_000, 10_000] as const
type StressCount = (typeof STRESS_COUNTS)[number]

export default function AutocompleteDevRoute() {
  const [eraValue, setEraValue] = React.useState('')
  const [eraCommitted, setEraCommitted] = React.useState<string | null>(null)
  const [tagValue, setTagValue] = React.useState('')
  const [freeFormValue, setFreeFormValue] = React.useState('')
  const [stressCount, setStressCount] = React.useState<StressCount>(1_000)
  const [stressValue, setStressValue] = React.useState('')
  // Generator runs only when count changes — typing in the input
  // re-renders the parent but doesn't regenerate the source list.
  const stressEntries = React.useMemo(() => generateStressEntries(stressCount), [stressCount])

  return (
    <ScrollView className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-8 p-4">
        <View className="gap-2">
          <Heading level={2}>Canonical casing (era_name field)</Heading>
          <Text size="sm" variant="muted">
            Default. Type &quot;reiwa&quot; lowercase and press Enter — commits as
            &quot;Reiwa&quot;. The five suggestions filter by case-insensitive substring match.
          </Text>
          <Autocomplete
            value={eraValue}
            onValueChange={setEraValue}
            onCommit={(v) => setEraCommitted(v)}
            sourceList={ERA_NAMES}
            label="Era name"
            placeholder="Era name…"
          />
          {eraCommitted && (
            <Text size="sm" variant="muted">
              Last committed: <Text className="font-medium">{eraCommitted}</Text>
            </Text>
          )}
        </View>

        <View className="gap-2">
          <Heading level={2}>As-typed casing (tag-style)</Heading>
          <Text size="sm" variant="muted">
            Hint-only source. User casing preserved on commit.
          </Text>
          <Autocomplete
            value={tagValue}
            onValueChange={setTagValue}
            sourceList={ERA_NAMES}
            casingNormalization="as-typed"
            label="Tag"
            placeholder="Tag…"
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Empty source (free-form)</Heading>
          <Text size="sm" variant="muted">
            No source list — degrades cleanly. The `+ Add new` row appears as soon as anything is
            typed; same UI shape as the canonical case.
          </Text>
          <Autocomplete
            value={freeFormValue}
            onValueChange={setFreeFormValue}
            label="Free-form input"
            placeholder="Type anything…"
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Disabled (no reason)</Heading>
          <Autocomplete
            value="Reiwa"
            onValueChange={() => {}}
            sourceList={ERA_NAMES}
            placeholder="Era name…"
            disabled
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Virtualization stress test</Heading>
          <Text size="sm" variant="muted">
            Synthetic entries — `Adjective Noun NNNN`, deterministic. Pick a count, then scroll and
            filter. Web uses `@tanstack/react-virtual`; native phone Sheet uses `FlatList`. Both
            should stay smooth at 10k entries; only the visible window mounts.
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {STRESS_COUNTS.map((c) => (
              <Chip
                key={c}
                selected={stressCount === c}
                onPress={() => {
                  setStressValue('')
                  setStressCount(c)
                }}
              >
                <Text>{c.toLocaleString()} entries</Text>
              </Chip>
            ))}
          </View>
          <Autocomplete
            value={stressValue}
            onValueChange={setStressValue}
            sourceList={stressEntries}
            label="Stress source"
            placeholder={`Filter ${stressCount.toLocaleString()} entries…`}
          />
        </View>

        <View className="gap-2">
          <Heading level={2}>Disabled with reason (web tooltip)</Heading>
          <Text size="sm" variant="muted">
            Browser-native tooltip surfaces the reason on hover (web only). Native ignores the
            wrapper until a Tooltip primitive lands.
          </Text>
          <Autocomplete
            value="Reiwa"
            onValueChange={() => {}}
            sourceList={ERA_NAMES}
            placeholder="Era name…"
            disabled
            disabledReason="Generation in progress — fields lock until complete"
          />
        </View>
      </View>
    </ScrollView>
  )
}
