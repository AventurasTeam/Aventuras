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

type Shared = Gate & {
  /** The pane's committed row; null while creating. */
  self: Entity | null
  entities: readonly Entity[]
  onOpenEntity: (id: string) => void
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
  self,
  entities,
  lastSeen,
  blocked,
  blockedReason,
}: Shared & {
  control: Control<CharacterDraft>
  trigger: UseFormTrigger<CharacterDraft>
  lastSeen: string | null
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
          {...gate}
        />
      </Section>
      <Section title={t('world:sections.relationships')}>
        <RelationshipsEditor
          control={control}
          trigger={trigger}
          selfId={self?.id ?? null}
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
  self,
  entities,
  onOpenEntity,
  blocked,
  blockedReason,
}: Shared & { control: Control<LocationDraft> }) {
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
          excludeIds={self == null ? [] : [self.id]}
          testID="parent-location"
          blocked={blocked}
          blockedReason={blockedReason}
        />
      </Section>
      <Section title={t('world:sections.charactersHere')}>
        <LinkList
          entities={self == null ? [] : charactersAt(self.id, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
      <Section title={t('world:sections.itemsHere')}>
        <LinkList
          entities={self == null ? [] : itemsAt(self.id, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
    </View>
  )
}

export function ItemConnections({
  control,
  self,
  entities,
  onOpenEntity,
  blocked,
  blockedReason,
}: Shared & { control: Control<ItemDraft> }) {
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
          blocked={blocked}
          blockedReason={blockedReason}
        />
      </Section>
      <Section title={t('world:sections.heldBy')}>
        <LinkList
          entities={self == null ? [] : holdersOf(self.id, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
    </View>
  )
}

export function FactionConnections({ self, entities, onOpenEntity }: Shared) {
  return (
    <View className="gap-6">
      <Section title={t('world:sections.members')}>
        <LinkList
          entities={self == null ? [] : membersOf(self.id, entities)}
          onOpenEntity={onOpenEntity}
        />
      </Section>
      <Text size="sm" variant="muted">
        {t('world:connections.interFaction')}
      </Text>
    </View>
  )
}
