import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Chip } from '@/components/ui/chip'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import type { WizardCastDraft } from '@/lib/db'
import { t } from '@/lib/i18n'

// Select carries string values; an empty string is indistinguishable from unset.
const NO_LOCATION = '__none__'

function displayName(row: WizardCastDraft): string {
  return row.name.trim() || t('wizard:cast.unnamed')
}

export type OpeningSceneTagsProps = {
  cast: readonly WizardCastDraft[]
  sceneEntities: readonly string[]
  currentLocationId: string | null
  onChangeSceneEntities: (next: string[]) => void
  onChangeLocation: (next: string | null) => void
}

/**
 * Scene grounding for the opening entry: who is present, where it happens.
 * Candidates are active-and-kind-filtered to match what Finish commits, so a ref
 * that fails that filter (since-staged row, character id in the location slot)
 * reads as unset instead of rendering a name in the wrong slot.
 */
export function OpeningSceneTags({
  cast,
  sceneEntities,
  currentLocationId,
  onChangeSceneEntities,
  onChangeLocation,
}: OpeningSceneTagsProps) {
  const sceneCandidates = cast.filter(
    (r) => r.status === 'active' && (r.kind === 'character' || r.kind === 'item'),
  )
  const locationCandidates = cast.filter((r) => r.status === 'active' && r.kind === 'location')

  const selected = new Set(sceneEntities)
  const toggle = (id: string): void => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Emitted off the filtered list, so an unresolvable ref drops on the next
    // explicit edit — user authorship; canon keeps such refs across cast edits.
    onChangeSceneEntities(sceneCandidates.map((r) => r.id).filter((id) => next.has(id)))
  }

  const locationValue =
    currentLocationId != null && locationCandidates.some((r) => r.id === currentLocationId)
      ? currentLocationId
      : NO_LOCATION

  return (
    <View className="gap-3">
      <FormRow label={t('wizard:opening.scene.cast')}>
        {sceneCandidates.length === 0 ? (
          <Text variant="muted" size="sm">
            {t('wizard:opening.scene.noCast')}
          </Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {sceneCandidates.map((row) => (
              <Chip key={row.id} selected={selected.has(row.id)} onPress={() => toggle(row.id)}>
                <Text>{displayName(row)}</Text>
              </Chip>
            ))}
          </View>
        )}
      </FormRow>

      <FormRow label={t('wizard:opening.scene.location')}>
        {locationCandidates.length === 0 ? (
          <Text variant="muted" size="sm">
            {t('wizard:opening.scene.noLocations')}
          </Text>
        ) : (
          <Select
            label={t('wizard:opening.scene.location')}
            options={
              [
                { value: NO_LOCATION, label: t('wizard:opening.scene.noLocationChosen') },
                ...locationCandidates.map((r) => ({ value: r.id, label: displayName(r) })),
              ] satisfies SelectOption[]
            }
            value={locationValue}
            onValueChange={(next) => onChangeLocation(next === NO_LOCATION ? null : next)}
          />
        )}
      </FormRow>
    </View>
  )
}
