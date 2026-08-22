import { BookMarked } from 'lucide-react-native'
import { useMemo, useState, type Ref } from 'react'
import { View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import {
  SearchableOverlayList,
  type Row,
  type Section,
  type TriggerProps,
} from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { type WizardPreset } from '@/lib/wizard'

export type PresetBrowserProps = {
  presets: readonly WizardPreset[]
  /** Accessible name for the trigger and the overlay heading. */
  ariaLabel: string
  onPick: (preset: WizardPreset) => void
}

function matches(preset: WizardPreset, query: string): boolean {
  if (query === '') return true
  const needle = query.toLowerCase()
  return (
    preset.displayName.toLowerCase().includes(needle) ||
    preset.tagline.toLowerCase().includes(needle) ||
    // The row renders a clamped promptBody, so a phrase the user can read there
    // has to be findable — otherwise typing it empties the list.
    preset.promptBody.toLowerCase().includes(needle)
  )
}

export function PresetBrowser({ presets, ariaLabel, onPick }: PresetBrowserProps) {
  const [query, setQuery] = useState('')

  const sections = useMemo<Section<WizardPreset>[]>(
    () => [
      {
        id: 'presets',
        rows: presets.filter((p) => matches(p, query)).map((p) => ({ id: p.id, data: p })),
      },
    ],
    [presets, query],
  )

  function renderTrigger(p: TriggerProps) {
    return (
      <IconAction
        ref={p.ref as Ref<View>}
        icon={BookMarked}
        label={ariaLabel}
        onPress={p.onPress}
      />
    )
  }

  function renderRow(row: Row<WizardPreset>) {
    return (
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-medium" numberOfLines={1}>
          {row.data.displayName}
        </Text>
        <Text variant="muted" size="sm" numberOfLines={2}>
          {row.data.tagline}
        </Text>
        {/* The clamp is visual only, so without this the row's accessible name —
            it is a role="option" named by its contents — carries the whole body. */}
        <Text variant="muted" size="xs" numberOfLines={1} aria-hidden>
          {row.data.promptBody}
        </Text>
      </View>
    )
  }

  return (
    <SearchableOverlayList<WizardPreset>
      searchPlacement="in-overlay"
      ariaLabel={ariaLabel}
      searchPlaceholder={t('wizard:world.presets.search')}
      sections={sections}
      onQueryChange={setQuery}
      renderTrigger={renderTrigger}
      renderRow={renderRow}
      onActivate={(row) => onPick(row.data)}
      // Phone keyboards cover a short sheet the moment search focuses; the
      // substrate's tall detent is the one that shrinks instead of sliding under.
      sheetSize="tall"
      autofocusSearch="web-only"
    />
  )
}
