import { Flag, MapPin, Package, Plus, Star, User, type LucideIcon } from 'lucide-react-native'
import { useMemo, useRef, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { ExpandableRow, useRowExpansion } from '@/components/compounds/expandable-row'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { WizardCastDraft } from '@/lib/db'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { AiAssist } from './ai-assist'
import { composeKey } from './assist-list-logic'
import {
  CharacterEditor,
  FactionEditor,
  ItemEditor,
  LocationEditor,
  SetAsLeadButton,
} from './cast-editors'
import { resolveCastImports } from './cast-import'
import { activeLead, invalidCastRowIds } from './step-cast-logic'
import {
  resolveWizardAssistModelId,
  runCastAssist,
  type CastAssistValue,
  type WizardAssistListRun,
} from './wizard-assist'

const KIND_ICON: Record<WizardCastDraft['kind'], LucideIcon> = {
  character: User,
  location: MapPin,
  item: Package,
  faction: Flag,
}

const KIND_ORDER = ['character', 'location', 'item', 'faction'] as const

/** Row identity for the per-row accessible names — blank rows are addressable too. */
function rowName(row: WizardCastDraft): string {
  return row.name.trim() || t('wizard:cast.unnamed')
}

// DI seam — stories/tests inject a fake so no real provider is hit. Production
// omits both and the live ops read the app-settings store.
export type CastAssistSeams = {
  resolveModelId?: () => string | null
  cast?: WizardAssistListRun<CastAssistValue>
}

function AddCastMenu({ onAdd }: { onAdd: (kind: WizardCastDraft['kind']) => void }) {
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)
  const isPhone = useTier() === 'phone'

  return (
    <Popover ariaLabel={t('wizard:cast.add')}>
      <PopoverTrigger ref={triggerRef} asChild>
        <Button variant="ghost">
          <Icon as={Plus} size="sm" />
          <Text>{t('wizard:cast.add')}</Text>
        </Button>
      </PopoverTrigger>
      {/* No container `role="menu"`: Popover implements no arrow-key roving, and
          declaring the role switches screen readers into a navigation mode the
          container does not honour. */}
      <PopoverContent align="end" className="w-56 p-1">
        <View className="flex-col">
          {KIND_ORDER.map((kind) => (
            <Pressable
              key={kind}
              accessibilityRole="menuitem"
              accessibilityLabel={t(`wizard:cast.kinds.${kind}`)}
              onPress={() => {
                triggerRef.current?.close()
                onAdd(kind)
              }}
              className={cn(
                'flex-row items-center gap-2 rounded-sm px-row-x-md py-row-y-md active:bg-tint-press',
                isPhone ? 'min-h-control-lg' : 'min-h-control-md',
                Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
              )}
            >
              <Icon as={KIND_ICON[kind]} size="sm" className="text-fg-secondary" />
              <Text size="sm" className="font-medium">
                {t(`wizard:cast.kinds.${kind}`)}
              </Text>
            </Pressable>
          ))}
        </View>
      </PopoverContent>
    </Popover>
  )
}

type CompactRowProps = {
  row: WizardCastDraft
  isLead: boolean
  invalid: boolean
  expanded: boolean
}

function CompactRow({ row, isLead, invalid, expanded }: CompactRowProps) {
  const staged = row.status === 'staged'
  return (
    <>
      <View className="flex-row flex-wrap items-center gap-2">
        <Icon
          as={KIND_ICON[row.kind]}
          aria-hidden
          size="sm"
          className={staged ? 'text-fg-muted' : 'text-fg-secondary'}
        />
        <Text className={cn('font-medium', staged && 'text-fg-muted')} numberOfLines={1}>
          {rowName(row)}
        </Text>
        {isLead ? (
          <Tag
            tone="accent"
            leading={<Icon as={Star} aria-hidden size="sm" className="fill-accent-fg" />}
          >
            {t('wizard:cast.leadChip')}
          </Tag>
        ) : null}
        {staged ? <Tag tone="success">{t('wizard:cast.stagedChip')}</Tag> : null}
      </View>
      {!expanded ? (
        <>
          {row.description.trim().length > 0 ? (
            <Text variant="muted" size="sm" numberOfLines={2}>
              {row.description}
            </Text>
          ) : null}
          {/* Gated by `invalid` alone (the parent's invalidCastRowIds read), not
              re-derived here — same split lore-list.tsx documents. `name` is the
              only CastRowField, so `invalid` already names the message. */}
          {invalid ? (
            <Text size="xs" className="text-danger">
              {t('wizard:cast.editor.errors.name')}
            </Text>
          ) : null}
        </>
      ) : null}
    </>
  )
}

type CastRowEditorProps = {
  row: WizardCastDraft
  invalid: boolean
  cast: readonly WizardCastDraft[]
  leadEntityId: string | null
}

function CastRowEditor({ row, invalid, cast, leadEntityId }: CastRowEditorProps) {
  switch (row.kind) {
    case 'character':
      return <CharacterEditor row={row} invalid={invalid} cast={cast} leadEntityId={leadEntityId} />
    case 'location':
      return <LocationEditor row={row} invalid={invalid} cast={cast} leadEntityId={leadEntityId} />
    case 'item':
      return <ItemEditor row={row} invalid={invalid} cast={cast} leadEntityId={leadEntityId} />
    case 'faction':
      return <FactionEditor row={row} invalid={invalid} cast={cast} leadEntityId={leadEntityId} />
  }
}

export type CastListProps = {
  /** "Set up in Settings" from the assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: CastAssistSeams
}

export function CastList({ onSetupAssist, assist }: CastListProps) {
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const leadEntityId = wizardStore.useWizard((s) => s.state.leadEntityId)

  const { expanded, toggle, expandAdded } = useRowExpansion(cast)
  const invalidIds = useMemo(() => new Set(invalidCastRowIds(cast)), [cast])

  const handleSetup = onSetupAssist ?? (() => {})
  const resolveModelId = assist?.resolveModelId ?? (() => resolveWizardAssistModelId())

  // The lead only counts while it points at an ACTIVE character; a hydrated
  // draft can name a staged one, and reading leadEntityId raw would badge that
  // row while the step's notice says no lead is set.
  const lead = activeLead(cast, leadEntityId)

  function handleAdd(kind: WizardCastDraft['kind']) {
    expandAdded(wizardStore.addCast(kind))
  }

  function handleRemove(id: string) {
    if (wizardStore.removeCast(id)) toast.info(t('wizard:cast.leadUnsetRemovedToast'))
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-end gap-2">
        <AiAssist
          ariaLabel={t('wizard:cast.suggest')}
          guidancePlaceholder={t('wizard:cast.guidance')}
          run={
            assist?.cast ??
            ((guidance, signal, exclude) => runCastAssist(guidance, signal, undefined, exclude))
          }
          resolveModelId={resolveModelId}
          result="list"
          // Kind-scoped identity on both sides: a name is only unique within a
          // kind, and composeKey normalizes each half so a padded suggestion
          // still collides with the row it duplicates.
          getItems={(v) =>
            v.entities.map((s) => ({
              name: s.name,
              detail: s.description,
              dedupeKey: composeKey(s.kind, s.name),
              payload: s,
            }))
          }
          existingKeys={cast.map((row) => composeKey(row.kind, row.name))}
          onImport={(payloads) => wizardStore.importCast(resolveCastImports(payloads, cast))}
          onSetup={handleSetup}
        />
        <AddCastMenu onAdd={handleAdd} />
      </View>
      {cast.length === 0 ? (
        <Text variant="muted" size="sm">
          {t('wizard:cast.empty')}
        </Text>
      ) : (
        <View className="gap-2">
          {cast.map((row) => {
            const isExpanded = expanded.has(row.id)
            const invalid = invalidIds.has(row.id)
            return (
              <ExpandableRow
                key={row.id}
                testID="cast-row"
                dataSet={{ castId: row.id }}
                invalid={invalid}
                expanded={isExpanded}
                onToggle={() => toggle(row.id)}
                onRemove={() => handleRemove(row.id)}
                // Interpolated per row: `aria-label` on the row Pressable
                // suppresses the row's own text, so a bare noun leaves every
                // expand — and every DESTRUCTIVE remove — announcing alike.
                removeLabel={t('wizard:cast.remove', { name: rowName(row) })}
                expandLabel={t('wizard:cast.expand', { name: rowName(row) })}
                collapseLabel={t('wizard:cast.collapse', { name: rowName(row) })}
                // ExpandableRow's own slot, which renders outside the row-wide
                // expand Pressable: nested in `compact` this would be a button
                // inside a button. Collapsed rows only — the expanded editor
                // carries the same button, and two would share one name.
                compactAction={
                  isExpanded ? undefined : <SetAsLeadButton row={row} leadEntityId={leadEntityId} />
                }
                compact={
                  <CompactRow
                    row={row}
                    isLead={lead?.id === row.id}
                    invalid={invalid}
                    expanded={isExpanded}
                  />
                }
                editor={
                  <CastRowEditor
                    row={row}
                    invalid={invalid}
                    cast={cast}
                    leadEntityId={leadEntityId}
                  />
                }
              />
            )
          })}
        </View>
      )}
    </View>
  )
}
