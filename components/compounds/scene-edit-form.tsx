import { useMemo, useState } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { MultiSelect } from '@/components/ui/multi-select'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

type EntityOption = { id: string; name: string }

export type SceneEdit = { sceneEntities: string[]; currentLocationId: string | null }

export type SceneOptions = {
  characters: EntityOption[]
  items: EntityOption[]
  locations: EntityOption[]
}

export type SceneEditFormProps = {
  /** The entry's current scene, seeding the controls. */
  sceneEntities: readonly string[]
  currentLocationId: string | null
  options: SceneOptions
  saving?: boolean
  saveError?: string
  onSave: (next: SceneEdit) => void
  /** Close the overlay. Also fires in place of `onSave` on a no-change save. */
  onCancel: () => void
}

/** Sentinel for "no location", since Select's value is a plain string. */
const NO_LOCATION = '__none__'

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function SceneEditForm({
  sceneEntities,
  currentLocationId,
  options,
  saving = false,
  saveError,
  onSave,
  onCancel,
}: SceneEditFormProps) {
  const [scene, setScene] = useState<string[]>([...sceneEntities])
  const [locationId, setLocationId] = useState<string>(currentLocationId ?? NO_LOCATION)

  // Characters and items share one control: sceneEntities carries both (a faction is
  // not in a scene the way a person is — data-model.md → Scene presence is kind-aware).
  const sceneChoices = useMemo(
    () => [...options.characters, ...options.items].map((e) => ({ value: e.id, label: e.name })),
    [options.characters, options.items],
  )

  const locationChoices = useMemo(
    () => [
      { value: NO_LOCATION, label: t('reader:sceneEdit.noLocation') },
      ...options.locations.map((l) => ({ value: l.id, label: l.name })),
    ],
    [options.locations],
  )

  const nextLocationId = locationId === NO_LOCATION ? null : locationId
  const unchanged = sameMembers(scene, sceneEntities) && nextLocationId === currentLocationId

  function handleSave() {
    // A Save with nothing changed takes the cancel route: no delta, no write, and
    // the overlay closes the same way an explicit Cancel closes it.
    if (unchanged) {
      onCancel()
      return
    }
    onSave({ sceneEntities: scene, currentLocationId: nextLocationId })
  }

  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text size="xs" variant="muted" className="uppercase tracking-wide">
          {t('reader:sceneEdit.inScene')}
        </Text>
        <MultiSelect
          prefix={t('reader:sceneEdit.inScene')}
          options={sceneChoices}
          selected={scene}
          onChange={setScene}
          disabled={saving}
        />
      </View>

      <View className="gap-1">
        <Text size="xs" variant="muted" className="uppercase tracking-wide">
          {t('reader:sceneEdit.location')}
        </Text>
        <Select
          options={locationChoices}
          value={locationId}
          onValueChange={setLocationId}
          label={t('reader:sceneEdit.location')}
          disabled={saving}
        />
      </View>

      {/* Applied, not merely recorded: these two fields drive materialized derived
          state, and removing someone never retires them. */}
      <Text size="xs" variant="muted">
        {t('reader:sceneEdit.applyNote')}
      </Text>

      {saveError != null ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Text size="xs" className="text-danger">
            {saveError}
          </Text>
        </View>
      ) : null}

      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={onCancel} disabled={saving}>
          <Text>{t('cancel')}</Text>
        </Button>
        {/* Save / Cancel only — no "Save and regen": regenerating re-runs piggyback,
            which emits a fresh <state> and overwrites the edit just saved. */}
        <Button variant="primary" size="sm" onPress={handleSave} loading={saving}>
          <Text>{t('save')}</Text>
        </Button>
      </View>
    </View>
  )
}
