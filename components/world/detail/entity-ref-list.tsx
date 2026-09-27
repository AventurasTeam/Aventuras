import { X } from 'lucide-react-native'
import { View } from 'react-native'

import { EntityPicker } from '@/components/compounds/entity-picker'
import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { IconAction } from '@/components/ui/icon-action'
import { Text } from '@/components/ui/text'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import type { Gate } from './fields'

const ITEM: readonly EntityKind[] = ['item']

type EntityRefListProps = Gate & {
  value: readonly string[]
  onChange: (next: string[]) => void
  entities: readonly Entity[]
  /** Hidden from the add picker besides this list's own — the other Carrying list. */
  excludeIds: readonly string[]
  rowHint: (entity: Entity) => string | undefined
  testID: string
  /** Unique per list: the pane's two add pickers need distinct accessible names. */
  addLabel: string
}

/** world.md → Carrying: an item-ref list, picker-backed, each row removable. */
export function EntityRefList({
  value,
  onChange,
  entities,
  excludeIds,
  rowHint,
  testID,
  addLabel,
  blocked,
  blockedReason,
}: EntityRefListProps) {
  const byId = new Map(entities.map((e) => [e.id, e]))
  return (
    <View className="gap-2" testID={testID}>
      {value.map((id) => {
        const entity = byId.get(id)
        const name = entity?.name ?? t('world:entityMissing')
        return (
          <View key={id} className="flex-row items-center gap-2">
            <View className="shrink-0">
              <EntityKindIcon kind="item" className="h-4 w-4" />
            </View>
            <Text
              size="sm"
              numberOfLines={1}
              className={cn('min-w-0 flex-1', entity == null && 'text-warning')}
            >
              {name}
            </Text>
            <IconAction
              icon={X}
              label={t('world:carrying.removeNamed', { name })}
              size="sm"
              disabled={blocked}
              disabledReason={blockedReason}
              onPress={() => onChange(value.filter((v) => v !== id))}
            />
          </View>
        )
      })}
      <EntityPicker
        value={null}
        onChange={(id) => {
          if (id != null) onChange([...value, id])
        }}
        entities={entities}
        kinds={ITEM}
        excludeIds={[...value, ...excludeIds]}
        label={addLabel}
        placeholder={addLabel}
        clearable={false}
        disabled={blocked}
        disabledReason={blockedReason}
        rowHint={rowHint}
      />
    </View>
  )
}
