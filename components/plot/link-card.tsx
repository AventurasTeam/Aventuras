import { ExternalLink, Trash2 } from 'lucide-react-native'
import type { ReactNode } from 'react'
import type { UseFormTrigger } from 'react-hook-form'
import { View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import type { Entity } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { t } from '@/lib/i18n'
import type { HappeningDraft } from '@/lib/plot'

type LinkList = 'involvements' | 'awareness'

type LinkCardProps = {
  list: LinkList
  testID: string
  /** The row's resolved entity; undefined while unpicked or dangling. */
  entity: Entity | undefined
  blocked: boolean
  blockedReason?: string
  onOpenEntity: (entity: Entity) => void
  onRemove: () => void
  children: ReactNode
}

/** A happening link row: its fields, then Open in World and Remove. */
export function LinkCard({
  list,
  testID,
  entity,
  blocked,
  blockedReason,
  onOpenEntity,
  onRemove,
  children,
}: LinkCardProps) {
  return (
    <View className="gap-2 rounded-md border border-border p-3" testID={testID}>
      {children}
      <View className="flex-row justify-end gap-2">
        {entity != null ? (
          <IconAction
            icon={ExternalLink}
            label={t(`plot:${list}.openInWorld`, { name: entity.name })}
            size="sm"
            onPress={() => onOpenEntity(entity)}
          />
        ) : null}
        <IconAction
          icon={Trash2}
          label={
            entity != null
              ? t(`plot:${list}.removeNamed`, { name: entity.name })
              : t(`plot:${list}.remove`)
          }
          size="sm"
          variant="destructive"
          disabled={blocked}
          disabledReason={blockedReason}
          onPress={onRemove}
        />
      </View>
    </View>
  )
}

/**
 * After a link row's removal. `useFieldArray`'s post-remove check compares only the array's
 * root error, so a survivor's stale per-row duplicate error needs a full revalidation.
 */
export function revalidateLinks(trigger: UseFormTrigger<HappeningDraft>, list: LinkList): void {
  trigger(list).catch((error: unknown) => {
    logger.error('app.plot_link_revalidate_failed', {
      list,
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
