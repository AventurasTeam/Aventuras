import * as React from 'react'
import { ScrollView, View } from 'react-native'

import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Autocomplete } from '@/components/ui/autocomplete'
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

export default function AutocompleteDevRoute() {
  const [eraValue, setEraValue] = React.useState('')
  const [eraCommitted, setEraCommitted] = React.useState<string | null>(null)
  const [tagValue, setTagValue] = React.useState('')
  const [freeFormValue, setFreeFormValue] = React.useState('')

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
