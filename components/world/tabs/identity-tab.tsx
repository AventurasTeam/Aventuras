import type { Control } from 'react-hook-form'
import { View } from 'react-native'

import { t } from '@/lib/i18n'
import {
  VISUAL_DRAFT_FIELDS,
  type CharacterDraft,
  type FactionDraft,
  type ItemDraft,
  type LocationDraft,
} from '@/lib/world'

import { ListField, TextField, type Gate } from '../detail/fields'
import { Section } from '../detail/section'

// world.md → Identity: description and kind-specific identity slots; no operational chrome.
export function CharacterIdentity({
  control,
  ...gate
}: Gate & { control: Control<CharacterDraft> }) {
  return (
    <View className="gap-6">
      <TextField
        control={control}
        name="description"
        label={t('world:fields.description')}
        multiline
        {...gate}
      />
      <Section title={t('world:sections.visual')}>
        {VISUAL_DRAFT_FIELDS.map(([field, key]) => (
          <TextField
            key={field}
            control={control}
            name={field}
            label={t(`world:fields.visual.${key}`)}
            maxLength={500}
            {...gate}
          />
        ))}
      </Section>
      <Section title={t('world:sections.personality')}>
        <ListField
          control={control}
          name="traits"
          label={t('world:fields.traits')}
          placeholder={t('world:fields.traitsPlaceholder')}
          {...gate}
        />
        <ListField
          control={control}
          name="drives"
          label={t('world:fields.drives')}
          placeholder={t('world:fields.drivesPlaceholder')}
          {...gate}
        />
        <TextField
          control={control}
          name="voice"
          label={t('world:fields.voice')}
          multiline
          maxLength={2000}
          {...gate}
        />
      </Section>
    </View>
  )
}

export function LocationIdentity({ control, ...gate }: Gate & { control: Control<LocationDraft> }) {
  return (
    <View className="gap-4">
      <TextField
        control={control}
        name="description"
        label={t('world:fields.description')}
        multiline
        {...gate}
      />
      <TextField
        control={control}
        name="condition"
        label={t('world:fields.condition')}
        maxLength={500}
        {...gate}
      />
    </View>
  )
}

export function ItemIdentity({ control, ...gate }: Gate & { control: Control<ItemDraft> }) {
  return (
    <View className="gap-4">
      <TextField
        control={control}
        name="description"
        label={t('world:fields.description')}
        multiline
        {...gate}
      />
      <TextField
        control={control}
        name="condition"
        label={t('world:fields.condition')}
        maxLength={500}
        {...gate}
      />
    </View>
  )
}

export function FactionIdentity({ control, ...gate }: Gate & { control: Control<FactionDraft> }) {
  return (
    <View className="gap-4">
      <TextField
        control={control}
        name="description"
        label={t('world:fields.description')}
        multiline
        {...gate}
      />
      <TextField
        control={control}
        name="standing"
        label={t('world:fields.standing')}
        maxLength={500}
        {...gate}
      />
      <ListField
        control={control}
        name="agenda"
        label={t('world:fields.agenda')}
        placeholder={t('world:fields.agendaPlaceholder')}
        {...gate}
      />
    </View>
  )
}
