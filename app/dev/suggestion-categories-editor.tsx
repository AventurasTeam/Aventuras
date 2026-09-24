import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import {
  SuggestionCategoriesEditor,
  type SuggestionCategory,
} from '@/components/compounds/suggestion-categories-editor'
import { ThemePicker } from '@/components/foundations/sections/theme-picker'
import { Button } from '@/components/ui/button'
import { type ColorValue } from '@/components/ui/color-picker'
import { Heading } from '@/components/ui/heading'
import { Switch } from '@/components/ui/switch'
import { Text } from '@/components/ui/text'

const SWATCHES: ColorValue[] = [
  '#ef4444',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

const FALLBACK: ColorValue = '#9ca3af'

const SEED: SuggestionCategory[] = [
  {
    id: 'cat-action',
    label: 'Action',
    color: '#ef4444',
    promptHint: 'Move the story forward with a decisive action.',
    enabled: true,
  },
  {
    id: 'cat-dialogue',
    label: 'Dialogue',
    color: '#3b82f6',
    promptHint: 'Suggest something for the protagonist to say next.',
    enabled: true,
  },
  {
    id: 'cat-observe',
    label: 'Observe',
    color: '#22c55e',
    promptHint: 'Suggest something the protagonist could examine.',
    enabled: true,
  },
]

export default function SuggestionCategoriesEditorDevRoute() {
  const [categories, setCategories] = useState<SuggestionCategory[]>(SEED)
  const [masterEnabled, setMasterEnabled] = useState(true)

  return (
    <ScrollView keyboardShouldPersistTaps="handled" className="flex-1 bg-bg-base">
      <ThemePicker />
      <View className="flex-col gap-4 p-4">
        <Heading level={3}>SuggestionCategoriesEditor</Heading>
        <Text variant="muted" size="xs">
          Desktop: drag the ≡ handle to reorder. Phone: long-press the handle on each accordion row.
          Add categories with the bottom button; delete with the trash icon. The master toggle dims
          the editor when off (Story Settings’ suggestionsEnabled gate).
        </Text>

        <View className="flex-row items-center gap-2">
          <Switch
            checked={masterEnabled}
            onCheckedChange={setMasterEnabled}
            aria-label="Master suggestions toggle"
          />
          <Text size="sm">Suggestions enabled (master toggle)</Text>
        </View>

        <SuggestionCategoriesEditor
          categories={categories}
          onChange={setCategories}
          swatches={SWATCHES}
          fallbackColor={FALLBACK}
          disabled={!masterEnabled}
        />

        <View className="flex-row gap-2">
          <Button variant="secondary" size="sm" onPress={() => setCategories(SEED)}>
            <Text>Reset to seed</Text>
          </Button>
          <Button variant="secondary" size="sm" onPress={() => setCategories([])}>
            <Text>Clear</Text>
          </Button>
        </View>

        <View className="rounded-md border border-border bg-bg-overlay p-3">
          <Text size="xs" variant="muted" className="font-medium">
            Current order ({categories.length}):
          </Text>
          {categories.map((c, i) => (
            <Text key={c.id} size="xs" variant="muted">
              {i + 1}. {c.label || '(empty)'} {c.enabled ? '' : '— off'}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  )
}
