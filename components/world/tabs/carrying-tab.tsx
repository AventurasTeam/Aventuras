import { Controller, useWatch, type Control, type UseFormTrigger } from 'react-hook-form'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { CharacterDraft } from '@/lib/world'

import { EntityRefList } from '../detail/entity-ref-list'
import type { Gate } from '../detail/fields'
import { Section } from '../detail/section'
import { StackablesEditor } from '../detail/stackables-editor'
import { itemPositionHint } from '../world-copy'

// world.md → Carrying — character-only: quantities, then Equipped, then Carried.
export function CarryingTab({
  control,
  trigger,
  entities,
  selfId,
  blocked,
  blockedReason,
}: Gate & {
  control: Control<CharacterDraft>
  trigger: UseFormTrigger<CharacterDraft>
  entities: readonly Entity[]
  selfId: string | null
}) {
  const equipped = useWatch({ control, name: 'equippedItems' })
  const carried = useWatch({ control, name: 'inventory' })
  const gate = { blocked, blockedReason }
  const hint = (item: Entity) => itemPositionHint(item, entities, selfId)
  return (
    <View className="gap-6">
      <Section title={t('world:sections.quantities')}>
        <StackablesEditor control={control} trigger={trigger} {...gate} />
        <Text size="xs" variant="muted">
          {t('world:carrying.footnote')}
        </Text>
      </Section>
      <Section title={t('world:sections.equipped')}>
        <Controller
          control={control}
          name="equippedItems"
          render={({ field }) => (
            <EntityRefList
              value={field.value}
              onChange={field.onChange}
              entities={entities}
              excludeIds={carried}
              rowHint={hint}
              testID="equipped"
              {...gate}
            />
          )}
        />
      </Section>
      <Section title={t('world:sections.carried')}>
        <Controller
          control={control}
          name="inventory"
          render={({ field }) => (
            <EntityRefList
              value={field.value}
              onChange={field.onChange}
              entities={entities}
              excludeIds={equipped}
              rowHint={hint}
              testID="carried"
              {...gate}
            />
          )}
        />
      </Section>
    </View>
  )
}
