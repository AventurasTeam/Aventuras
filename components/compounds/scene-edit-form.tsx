import { BottomSheetScrollView } from '@gorhom/bottom-sheet'
import { useMemo, useState } from 'react'
import { ScrollView, View, type ViewProps, type ViewStyle } from 'react-native'

import { Button } from '@/components/ui/button'
import { MultiSelectList } from '@/components/ui/multi-select'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

type EntityOption = { id: string; name: string }

/** Mirrors the action layer's rejection, which the bridge carries as plain JSON. */
export type SceneSaveResult = { ok: true } | { ok: false; code?: string }

/**
 * Only `deltaFailed` is worth retrying. The others are terminal, and the generic
 * "try again" copy sends the user round a loop they cannot exit. Codes are
 * STORY_ENTRY_REJECTION's (lib/actions/story-entries/register.ts).
 */
type SceneSaveErrorKey =
  | 'reader:sceneEdit.failed'
  | 'reader:sceneEdit.failedInFlight'
  | 'reader:sceneEdit.failedNotTail'
  | 'reader:sceneEdit.failedNoMetadata'
  | 'reader:sceneEdit.failedNotFound'

export function sceneSaveErrorKey(code: string | undefined): SceneSaveErrorKey {
  switch (code) {
    case 'in-flight-gated':
      return 'reader:sceneEdit.failedInFlight'
    case 'not-tail-entry':
      return 'reader:sceneEdit.failedNotTail'
    case 'no-metadata':
      return 'reader:sceneEdit.failedNoMetadata'
    case 'not-found':
      return 'reader:sceneEdit.failedNotFound'
    default:
      return 'reader:sceneEdit.failed'
  }
}

export type SceneEdit = { sceneEntities: string[]; currentLocationId: string | null }

export type SceneOptions = {
  characters: EntityOption[]
  items: EntityOption[]
  locations: EntityOption[]
}

export type SceneEditFormProps = {
  /**
   * The entry's current scene. Read on mount only — remount via `key` to reseed after
   * an external change, or the form shows a stale scene over a changed row.
   */
  sceneEntities: readonly string[]
  currentLocationId: string | null
  options: SceneOptions
  /**
   * True when the form is presented in a bottom sheet (the phone tier). Both controls
   * are inline regardless — a Sheet may not open over a Sheet, and every picker
   * primitive here presents as one on phone — but the list needs the sheet's own
   * scroll host to avoid fighting its drag gesture.
   */
  insideSheet?: boolean
  saving?: boolean
  saveError?: string
  onSave: (next: SceneEdit) => void
  /** Close the overlay. Also fires in place of `onSave` on a no-change save. */
  onCancel: () => void
}

/** Sentinel for "no location", since Select's value is a plain string. */
const NO_LOCATION = '__none__'

const FILL: ViewStyle = { flex: 1 }

/** The sheet needs gorhom's own scroll host so the rows don't fight its drag gesture. */
function Body({
  insideSheet,
  children,
}: {
  insideSheet: boolean
  children: ViewProps['children']
}) {
  if (!insideSheet) {
    return (
      <ScrollView className="shrink" contentContainerClassName="gap-3">
        {children}
      </ScrollView>
    )
  }
  return (
    <BottomSheetScrollView contentContainerClassName="gap-3 pb-3" style={FILL}>
      {children}
    </BottomSheetScrollView>
  )
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function SceneEditForm({
  sceneEntities,
  currentLocationId,
  options,
  insideSheet = false,
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
    <View className={insideSheet ? 'flex-1' : 'shrink'}>
      {/* The lists below are unbounded, so nothing inside them may add a scroll
          region of its own. */}
      <Body insideSheet={insideSheet}>
        <View className="gap-1">
          <Text size="xs" variant="muted" className="uppercase tracking-wide">
            {t('reader:sceneEdit.inScene')}
          </Text>
          <MultiSelectList
            options={sceneChoices}
            selected={scene}
            onChange={setScene}
            disabled={saving}
            insideSheet={insideSheet}
            scroll="none"
          />
        </View>

        <View className="gap-1">
          <Text size="xs" variant="muted" className="uppercase tracking-wide">
            {t('reader:sceneEdit.location')}
          </Text>
          {/* Forced to radio: the auto-derivation picks `dropdown` past seven options or
            on phone, and dropdown is the branch that opens a Sheet. Radio renders
            inline on every tier. */}
          <Select
            mode="radio"
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
      </Body>

      {saveError != null ? (
        <View role="alert" accessibilityLiveRegion="assertive">
          <Text size="xs" className="text-danger">
            {saveError}
          </Text>
        </View>
      ) : null}

      <View className="flex-row justify-end gap-2 pt-3">
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
