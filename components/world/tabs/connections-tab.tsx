import type { Control, UseFormTrigger } from 'react-hook-form'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import type { Entity, EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import {
  charactersAt,
  holdersOf,
  itemsAt,
  membersOf,
  type CharacterDraft,
  type ItemDraft,
  type LocationDraft,
} from '@/lib/world'

import { RefField, type Gate } from '../detail/fields'
import { RelationshipsEditor } from '../detail/relationships-editor'
import { Section } from '../detail/section'
import { EntityLink } from '../overview/overview-parts'

const LOCATION: readonly EntityKind[] = ['location']
const FACTION: readonly EntityKind[] = ['faction']

type Shared = {
  /** The pane's committed row id; null while creating. */
  selfId: string | null
  entities: readonly Entity[]
}

function LinkList({
  entities,
  onOpenEntity,
}: {
  entities: readonly Entity[]
  onOpenEntity: (id: string) => void
}) {
  if (entities.length === 0)
    return (
      <Text size="sm" variant="muted">
        {t('world:connections.none')}
      </Text>
    )
  return (
    <View className="gap-1">
      {entities.map((e) => (
        <EntityLink key={e.id} entity={e} onPress={() => onOpenEntity(e.id)} />
      ))}
    </View>
  )
}

// world.md → Connections, Character: Positional, Affiliation, Relationships, Last seen (read-only).
export function CharacterConnections({
  control,
  trigger,
  selfId,
  entities,
  lastSeen,
  onOpenEntity,
  blocked,
  blockedReason,
}: Shared &
  Gate & {
    control: Control<CharacterDraft>
    trigger: UseFormTrigger<CharacterDraft>
    lastSeen: string | null
    onOpenEntity: (id: string) => void
  }) {
  const gate = { blocked, blockedReason }
  return (
    <View className="gap-6">
      <Section title={t('world:sections.positional')}>
        <RefField
          control={control}
          name="currentLocationId"
          label={t('world:fields.currentLocation')}
          placeholder={t('world:fields.locationPlaceholder')}
          entities={entities}
          kinds={LOCATION}
          onOpenEntity={onOpenEntity}
          {...gate}
        />
      </Section>
      <Section title={t('world:sections.affiliation')}>
        <RefField
          control={control}
          name="factionId"
          label={t('world:fields.faction')}
          placeholder={t('world:fields.factionPlaceholder')}
          entities={entities}
          kinds={FACTION}
          onOpenEntity={onOpenEntity}
          {...gate}
        />
      </Section>
      <Section title={t('world:sections.relationships')}>
        <RelationshipsEditor
          control={control}
          trigger={trigger}
          selfId={selfId}
          entities={entities}
          {...gate}
        />
      </Section>
      <Section title={t('world:sections.lastSeen')}>
        {/* data-model.md → Authorship contract: lastSeenAt is classifier-only. */}
        <Text size="sm" variant="muted" testID="connections-last-seen">
          {lastSeen ?? t('world:connections.lastSeenNever')}
        </Text>
      </Section>
    </View>
  )
}

export function LocationConnections({
  control,
  selfId,
  entities,
  onOpenEntity,
  blocked,
  blockedReason,
}: Shared &
  Gate & {
    control: Control<LocationDraft>
    onOpenEntity: (id: string) => void
  }) {
  return (
    <View className="gap-6">
      <Section title={t('world:sections.compositional')}>
        <RefField
          control={control}
          name="parentLocationId"
          label={t('world:fields.parentLocation')}
          placeholder={t('world:fields.parentPlaceholder')}
          entities={entities}
          kinds={LOCATION}
          excludeIds={selfId == null ? [] : [selfId]}
          testID="parent-location"
          onOpenEntity={onOpenEntity}
          blocked={blocked}
          blockedReason={blockedReason}
        />
      </Section>
      <Section title={t('world:sections.charactersHere')}>
        <LinkList
          entities={selfId == null ? [] : charactersAt(selfId, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
      <Section title={t('world:sections.itemsHere')}>
        <LinkList
          entities={selfId == null ? [] : itemsAt(selfId, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
    </View>
  )
}

export function ItemConnections({
  control,
  selfId,
  entities,
  onOpenEntity,
  blocked,
  blockedReason,
}: Shared &
  Gate & {
    control: Control<ItemDraft>
    onOpenEntity: (id: string) => void
  }) {
  return (
    <View className="gap-6">
      <Section title={t('world:sections.positional')}>
        <RefField
          control={control}
          name="atLocationId"
          label={t('world:fields.atLocation')}
          placeholder={t('world:fields.locationPlaceholder')}
          entities={entities}
          kinds={LOCATION}
          onOpenEntity={onOpenEntity}
          blocked={blocked}
          blockedReason={blockedReason}
        />
      </Section>
      <Section title={t('world:sections.heldBy')}>
        <LinkList
          entities={selfId == null ? [] : holdersOf(selfId, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
    </View>
  )
}

export function FactionConnections({
  selfId,
  entities,
  onOpenEntity,
}: Shared & { onOpenEntity: (id: string) => void }) {
  return (
    <View className="gap-6">
      <Section title={t('world:sections.members')}>
        <LinkList
          entities={selfId == null ? [] : membersOf(selfId, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
      <Text size="sm" variant="muted">
        {t('world:connections.interFaction')}
      </Text>
    </View>
  )
}
