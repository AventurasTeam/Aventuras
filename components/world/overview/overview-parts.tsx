import type { ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { ENTITY_STATUS_TONE } from '@/components/entity/entity-row'
import { Avatar } from '@/components/ui/avatar'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import type { CalendarSystem } from '@/lib/calendar'
import type { Entity } from '@/lib/db'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { ChipPreview } from '@/lib/world'

import type { EntityTab } from '../detail/entity-tabs'

export type RegionPress = (tab: EntityTab) => void

export type KindBodyProps = {
  entity: Entity
  entities: readonly Entity[]
  worldTime: number
  calendar: CalendarSystem
  onRegionPress: RegionPress
  onOpenEntity: (id: string) => void
}

const PRESSABLE = cn('rounded-md', Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }))

export function editInLabel(tab: EntityTab): string {
  return t('world:overview.editIn', { tab: t(`world:detail.tabs.${tab}`) })
}

function RegionLabel({ label }: { label: string }) {
  return (
    <Text size="xs" variant="muted" className="font-medium uppercase tracking-wide">
      {label}
    </Text>
  )
}

function NotDescribed() {
  return (
    <View className="flex-row flex-wrap items-baseline gap-2">
      <Text size="sm" variant="muted">
        {t('world:overview.notDescribed')}
      </Text>
      <Text size="sm" className="text-accent">
        {t('world:overview.add')}
      </Text>
    </View>
  )
}

type RegionProps = {
  label?: string
  tab: EntityTab
  onRegionPress: RegionPress
  empty: boolean
  children?: ReactNode
  testID: string
}

/** A region with no links: the whole region routes to its edit tab (world.md → Overview). */
export function Region({ label, tab, onRegionPress, empty, children, testID }: RegionProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityHint={editInLabel(tab)}
      onPress={() => onRegionPress(tab)}
      className={cn('gap-1 px-1 py-2', PRESSABLE)}
    >
      {label != null ? <RegionLabel label={label} /> : null}
      {empty ? <NotDescribed /> : children}
    </Pressable>
  )
}

export function EntityLink({ entity, onPress }: { entity: Entity; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      className={cn('shrink', Platform.select({ web: 'cursor-pointer' }))}
    >
      <Text size="sm" className="underline decoration-dotted">
        {entity.name}
      </Text>
    </Pressable>
  )
}

type LinkRegionProps = {
  label: string
  tab: EntityTab
  onRegionPress: RegionPress
  /** Resolved targets; null is a dangling id. */
  targets: readonly (Entity | null)[]
  onOpenEntity: (id: string) => void
  meta?: string
  joiner?: string
  /** An inverse list has nothing to add from here: it says "None" instead of "add →". */
  derived?: boolean
  testID: string
}

/**
 * A region with entity links. The label routes to the edit tab and each name opens its entity —
 * sibling press targets, never nested (a link inside a button is two controls in one).
 */
export function LinkRegion({
  label,
  tab,
  onRegionPress,
  targets,
  onOpenEntity,
  meta,
  joiner = ', ',
  derived = false,
  testID,
}: LinkRegionProps) {
  return (
    <View className="gap-1 px-1 py-2" testID={testID}>
      <Pressable
        testID={`${testID}-label`}
        accessibilityRole="button"
        accessibilityHint={editInLabel(tab)}
        onPress={() => onRegionPress(tab)}
        className={cn('self-start', PRESSABLE)}
      >
        <RegionLabel label={label} />
      </Pressable>
      {targets.length === 0 ? (
        derived ? (
          <Text size="sm" variant="muted">
            {t('world:connections.none')}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint={editInLabel(tab)}
            onPress={() => onRegionPress(tab)}
            className={cn('self-start', PRESSABLE)}
          >
            <NotDescribed />
          </Pressable>
        )
      ) : (
        <View className="min-w-0 flex-row flex-wrap items-baseline">
          {targets.map((entity, i) => (
            <View key={entity?.id ?? `missing-${i}`} className="max-w-full flex-row items-baseline">
              {i > 0 ? (
                <Text size="sm" variant="muted">
                  {joiner}
                </Text>
              ) : null}
              {entity != null ? (
                <EntityLink entity={entity} onPress={() => onOpenEntity(entity.id)} />
              ) : (
                <Text size="sm" className="text-warning">
                  {t('world:overview.missing')}
                </Text>
              )}
            </View>
          ))}
          {meta != null ? (
            <Text size="xs" variant="muted">
              {` · ${meta}`}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  )
}

export function ChipRow({ preview }: { preview: ChipPreview }) {
  return (
    <View className="flex-row flex-wrap gap-1.5">
      {preview.shown.map((value, i) => (
        <Tag key={`${value}-${i}`} tone="soft" className="max-w-full">
          {value}
        </Tag>
      ))}
      {preview.more > 0 ? <Tag>{t('world:overview.more', { count: preview.more })}</Tag> : null}
    </View>
  )
}

/** Status pill, `retired_reason` inline, and the non-default injection chip; routes to Settings. */
export function StatusRow({
  entity,
  onRegionPress,
}: {
  entity: Entity
  onRegionPress: RegionPress
}) {
  const reason = entity.status === 'retired' ? entity.retiredReason?.trim() : undefined
  return (
    <Pressable
      testID="overview-status"
      accessibilityRole="button"
      accessibilityHint={editInLabel('settings')}
      onPress={() => onRegionPress('settings')}
      className={cn('flex-row flex-wrap items-center gap-2 self-start px-1 py-1', PRESSABLE)}
    >
      {entity.kind !== 'character' ? <EntityKindIcon kind={entity.kind} /> : null}
      <Tag tone={ENTITY_STATUS_TONE[entity.status]}>{t(`world:status.${entity.status}`)}</Tag>
      {reason ? (
        <Text size="sm" variant="muted">
          {t('world:overview.retiredReason', { reason })}
        </Text>
      ) : null}
      {entity.injectionMode !== 'auto' ? (
        <ReasonTooltip reason={t(`world:fields.injection.${entity.injectionMode}Help`)}>
          <Tag>{t(`world:overview.injectionChip.${entity.injectionMode}`)}</Tag>
        </ReasonTooltip>
      ) : null}
    </Pressable>
  )
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

/** A placeholder slot sized as the gallery pass will fill it, so it never re-lays out. */
export function PortraitSlot({ entity, size }: { entity: Entity; size: 'md' | 'lg' }) {
  return (
    <Avatar
      size={size}
      alt={t('world:overview.portrait', { name: entity.name })}
      fallback={initials(entity.name)}
      testID="overview-portrait"
    />
  )
}
