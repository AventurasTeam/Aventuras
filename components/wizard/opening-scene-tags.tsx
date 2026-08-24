import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Chip } from '@/components/ui/chip'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import type { WizardCastDraft } from '@/lib/db'
import { t } from '@/lib/i18n'

// Select carries string values, so "no location" needs a sentinel rather than
// an empty string, which is indistinguishable from an unset trigger.
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
 * Both authorship paths edit the same fields — an AI-generated opening seeds
 * them through structured output and the user may correct them here, which is
 * the only remedy that doesn't discard prose edits the way regenerating does.
 *
 * Candidates are active-and-kind-filtered to match the filter Finish commits
 * through, so nothing offered here is silently dropped on the way to
 * `story_entries.metadata`, and a ref that fails that filter (a since-staged
 * row, or a character id sitting in the location slot) reads as unset rather
 * than rendering someone's name in the wrong slot.
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
    // Emitted in candidate order off the filtered list, so a ref that no longer
    // resolves drops on the next explicit edit. Canon keeps such refs across
    // cast edits; this is the user authoring, not an auto-clear.
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
