import { Star } from 'lucide-react-native'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { TagInput } from '@/components/compounds/tag-input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useTier } from '@/hooks/use-tier'
import type {
  WizardCastDraft,
  WizardCharacterDraft,
  WizardFactionDraft,
  WizardItemDraft,
  WizardLocationDraft,
} from '@/lib/db'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

import { canSetLead } from './step-cast-logic'

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: t('wizard:cast.editor.statusActive') },
  { value: 'staged', label: t('wizard:cast.editor.statusStaged') },
]

// docs/data-model.md → Soft caps + compaction discipline: prompt-discipline
// ceilings, not Zod-enforced. Applied here as `maxCount` so wizard-authored
// rows start under the same ceiling the classifier is held to.
const TRAITS_CAP = 8
const DRIVES_CAP = 6
const AGENDA_CAP = 4

const VISUAL_FIELDS = ['physique', 'face', 'hair', 'eyes', 'attire', 'distinguishing'] as const

const NULL_CAST_REF = '__none__'

function handleStatusChange(id: string, status: 'active' | 'staged') {
  if (wizardStore.setCastStatus(id, status)) {
    toast.info(t('wizard:cast.leadUnsetToast'))
  }
}

export type CommonEditorProps<T extends WizardCastDraft> = {
  row: T
  /** Gates the name field's error state — same `invalidIds` split as `LoreListProps` in lore-list.tsx. */
  invalid: boolean
  cast: readonly WizardCastDraft[]
  leadEntityId: string | null
}

function NameStatusRow({ row, invalid }: { row: WizardCastDraft; invalid: boolean }) {
  const isPhone = useTier() === 'phone'
  const nameError = invalid
  return (
    // Phone stacks: the status column can't shrink below its two segments, and
    // taking that off a 320 px screen leaves the name field unusable.
    // Both rows are pinned `stacked` because the status column sizes to its
    // control and can never host FormRow's 120/180 px label column — left to
    // auto-derive, a wide window puts two label treatments in one visual row.
    <View className={cn('gap-3', isPhone ? 'flex-col' : 'flex-row items-start')}>
      <FormRow
        className={isPhone ? undefined : 'flex-1'}
        stacked
        label={t('wizard:cast.editor.name')}
        error={nameError ? t('wizard:cast.editor.errors.name') : undefined}
      >
        <Input
          value={row.name}
          onChangeText={(name) => wizardStore.patchCast(row, { name })}
          aria-label={t('wizard:cast.editor.name')}
          aria-invalid={nameError}
        />
      </FormRow>
      <FormRow stacked label={t('wizard:cast.editor.status')}>
        <Select
          options={STATUS_OPTIONS}
          value={row.status}
          onValueChange={(status) => handleStatusChange(row.id, status as 'active' | 'staged')}
          label={t('wizard:cast.editor.status')}
        />
      </FormRow>
    </View>
  )
}

function DescriptionRow({ row }: { row: WizardCastDraft }) {
  return (
    <FormRow label={t('wizard:cast.editor.description')}>
      <Textarea
        value={row.description}
        onChangeText={(description) => wizardStore.patchCast(row, { description })}
        aria-label={t('wizard:cast.editor.description')}
        rows={3}
      />
    </FormRow>
  )
}

function TagsRow({ row }: { row: WizardCastDraft }) {
  return (
    <FormRow label={t('wizard:cast.editor.tags')} hint={t('wizard:cast.editor.tagsHint')}>
      <TagInput
        value={row.tags}
        onChange={(tags) => wizardStore.patchCast(row, { tags })}
        placeholder={t('wizard:cast.editor.tagsPlaceholder')}
      />
    </FormRow>
  )
}

type PickFromCastProps = {
  label: string
  emptyLabel: string
  nullLabel: string
  candidates: readonly { id: string; name: string }[]
  value: string | null
  onChange: (value: string | null) => void
}

function PickFromCast({
  label,
  emptyLabel,
  nullLabel,
  candidates,
  value,
  onChange,
}: PickFromCastProps) {
  if (candidates.length === 0) {
    return (
      <FormRow label={label}>
        <Text variant="muted" size="sm">
          {emptyLabel}
        </Text>
      </FormRow>
    )
  }
  const options: SelectOption[] = [
    { value: NULL_CAST_REF, label: nullLabel },
    ...candidates.map((c) => ({ value: c.id, label: c.name.trim() || t('wizard:cast.unnamed') })),
  ]
  return (
    <FormRow label={label}>
      <Select
        options={options}
        value={value ?? NULL_CAST_REF}
        onValueChange={(next) => onChange(next === NULL_CAST_REF ? null : next)}
        label={label}
      />
    </FormRow>
  )
}

type SetAsLeadButtonProps = {
  row: WizardCastDraft
  leadEntityId: string | null
}

// Reassignment is silent by design: the ⭐ Lead chip moving to this row is the
// direct, expected result of the button just pressed, unlike the staged/
// removed lead-unset paths (which toast because the lead vanishes as a side
// effect of an unrelated action, with no local chip left to show it).
export function SetAsLeadButton({ row, leadEntityId }: SetAsLeadButtonProps) {
  if (!canSetLead(row, leadEntityId)) return null
  return (
    // RN's default alignItems: stretch would span the Button full-width
    // across the editor column otherwise.
    <View className="items-start">
      <Button variant="secondary" size="sm" onPress={() => wizardStore.setLeadEntityId(row.id)}>
        <Icon as={Star} aria-hidden size="sm" className="fill-fg-secondary" />
        <Text>{t('wizard:cast.setAsLead')}</Text>
      </Button>
    </View>
  )
}

export function CharacterEditor({
  row,
  invalid,
  cast,
  leadEntityId,
}: CommonEditorProps<WizardCharacterDraft>) {
  const factionCandidates = cast.filter((r): r is WizardFactionDraft => r.kind === 'faction')
  return (
    <>
      <NameStatusRow row={row} invalid={invalid} />
      <DescriptionRow row={row} />
      {/* Labelled "Speech" — the state key it writes stays `voice`. */}
      <FormRow label={t('wizard:cast.editor.speech')}>
        <Input
          value={row.voice}
          onChangeText={(voice) => wizardStore.patchCast(row, { voice })}
          placeholder={t('wizard:cast.editor.speechPlaceholder')}
          aria-label={t('wizard:cast.editor.speech')}
        />
      </FormRow>
      <FormRow label={t('wizard:cast.editor.traits')}>
        <TagInput
          value={row.traits}
          onChange={(traits) => wizardStore.patchCast(row, { traits })}
          placeholder={t('wizard:cast.editor.traitsPlaceholder')}
          maxCount={TRAITS_CAP}
        />
      </FormRow>
      <FormRow label={t('wizard:cast.editor.drives')}>
        <TagInput
          value={row.drives}
          onChange={(drives) => wizardStore.patchCast(row, { drives })}
          placeholder={t('wizard:cast.editor.drivesPlaceholder')}
          maxCount={DRIVES_CAP}
        />
      </FormRow>
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="visual">
          <AccordionTrigger>
            <Text>{t('wizard:cast.editor.visual')}</Text>
          </AccordionTrigger>
          <AccordionContent className="gap-3">
            {VISUAL_FIELDS.map((field) => (
              <FormRow key={field} label={t(`wizard:cast.editor.${field}`)}>
                <Input
                  value={row.visual[field]}
                  onChangeText={(text) =>
                    wizardStore.patchCast(row, { visual: { ...row.visual, [field]: text } })
                  }
                  placeholder={t(`wizard:cast.editor.${field}Placeholder`)}
                  aria-label={t(`wizard:cast.editor.${field}`)}
                />
              </FormRow>
            ))}
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="more-options">
          <AccordionTrigger>
            <Text>{t('wizard:cast.editor.moreOptions')}</Text>
          </AccordionTrigger>
          <AccordionContent className="gap-3">
            <TagsRow row={row} />
            <PickFromCast
              label={t('wizard:cast.editor.faction')}
              emptyLabel={t('wizard:cast.editor.noFactionsYet')}
              nullLabel={t('wizard:cast.editor.unaffiliated')}
              candidates={factionCandidates}
              value={row.factionId}
              onChange={(factionId) => wizardStore.patchCast(row, { factionId })}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <SetAsLeadButton row={row} leadEntityId={leadEntityId} />
    </>
  )
}

export function LocationEditor({ row, invalid, cast }: CommonEditorProps<WizardLocationDraft>) {
  const locationCandidates = cast.filter(
    (r): r is WizardLocationDraft => r.kind === 'location' && r.id !== row.id,
  )
  return (
    <>
      <NameStatusRow row={row} invalid={invalid} />
      <DescriptionRow row={row} />
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="more-options">
          <AccordionTrigger>
            <Text>{t('wizard:cast.editor.moreOptions')}</Text>
          </AccordionTrigger>
          <AccordionContent className="gap-3">
            <TagsRow row={row} />
            <PickFromCast
              label={t('wizard:cast.editor.parentLocation')}
              emptyLabel={t('wizard:cast.editor.noLocationsYet')}
              nullLabel={t('wizard:cast.editor.noParent')}
              candidates={locationCandidates}
              value={row.parentLocationId}
              onChange={(parentLocationId) => wizardStore.patchCast(row, { parentLocationId })}
            />
            <FormRow label={t('wizard:cast.editor.condition')}>
              <Input
                value={row.condition}
                onChangeText={(condition) => wizardStore.patchCast(row, { condition })}
                placeholder={t('wizard:cast.editor.conditionPlaceholderLocation')}
                aria-label={t('wizard:cast.editor.condition')}
              />
            </FormRow>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  )
}

export function ItemEditor({ row, invalid }: CommonEditorProps<WizardItemDraft>) {
  return (
    <>
      <NameStatusRow row={row} invalid={invalid} />
      <DescriptionRow row={row} />
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="more-options">
          <AccordionTrigger>
            <Text>{t('wizard:cast.editor.moreOptions')}</Text>
          </AccordionTrigger>
          <AccordionContent className="gap-3">
            <TagsRow row={row} />
            <FormRow label={t('wizard:cast.editor.condition')}>
              <Input
                value={row.condition}
                onChangeText={(condition) => wizardStore.patchCast(row, { condition })}
                placeholder={t('wizard:cast.editor.conditionPlaceholderItem')}
                aria-label={t('wizard:cast.editor.condition')}
              />
            </FormRow>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  )
}

export function FactionEditor({ row, invalid }: CommonEditorProps<WizardFactionDraft>) {
  return (
    <>
      <NameStatusRow row={row} invalid={invalid} />
      <DescriptionRow row={row} />
      <FormRow label={t('wizard:cast.editor.agenda')}>
        <TagInput
          value={row.agenda}
          onChange={(agenda) => wizardStore.patchCast(row, { agenda })}
          placeholder={t('wizard:cast.editor.agendaPlaceholder')}
          maxCount={AGENDA_CAP}
        />
      </FormRow>
      <Accordion type="single" collapsible defaultValue="">
        <AccordionItem value="more-options">
          <AccordionTrigger>
            <Text>{t('wizard:cast.editor.moreOptions')}</Text>
          </AccordionTrigger>
          <AccordionContent className="gap-3">
            <TagsRow row={row} />
            <FormRow label={t('wizard:cast.editor.standing')}>
              <Input
                value={row.standing}
                onChangeText={(standing) => wizardStore.patchCast(row, { standing })}
                placeholder={t('wizard:cast.editor.standingPlaceholder')}
                aria-label={t('wizard:cast.editor.standing')}
              />
            </FormRow>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  )
}
