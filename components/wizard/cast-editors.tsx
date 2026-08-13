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
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
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

import { canSetLead, castRowErrors } from './step-cast-logic'

const STATUS_OPTIONS: SelectOption[] = [
  { value: 'active', label: t('wizard:cast.editor.statusActive') },
  { value: 'staged', label: t('wizard:cast.editor.statusStaged') },
]

// docs/data-model.md → Soft caps + compaction discipline: prompt-discipline
// ceilings, not Zod-enforced. Applied here as `maxCount` so wizard-authored
// rows start under the same ceiling the classifier is held to. An
// over-cap hydrated row (e.g. an AI-suggest import) still shows every
// chip with its own ×, so it stays pruneable rather than stuck.
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
  /** Gates the name field's error state — mirrors LoreList's `invalidIds` split (see cast-editors.stories.tsx). */
  invalid: boolean
  cast: readonly WizardCastDraft[]
  leadEntityId: string | null
}

function NameStatusRow({ row, invalid }: { row: WizardCastDraft; invalid: boolean }) {
  const nameError = invalid && castRowErrors(row).includes('name')
  return (
    <View className="flex-row items-start gap-3">
      <FormRow
        className="flex-1"
        label={t('wizard:cast.editor.name')}
        error={nameError ? t('wizard:cast.editor.errors.name') : undefined}
      >
        <Input
          value={row.name}
          onChangeText={(name) => wizardStore.patchCast(row.id, { name })}
          aria-label={t('wizard:cast.editor.name')}
          aria-invalid={nameError}
        />
      </FormRow>
      <View className="pt-2">
        <Select
          options={STATUS_OPTIONS}
          value={row.status}
          onValueChange={(status) => handleStatusChange(row.id, status as 'active' | 'staged')}
        />
      </View>
    </View>
  )
}

function DescriptionRow({ row }: { row: WizardCastDraft }) {
  return (
    <FormRow label={t('wizard:cast.editor.description')}>
      <Textarea
        value={row.description}
        onChangeText={(description) => wizardStore.patchCast(row.id, { description })}
        aria-label={t('wizard:cast.editor.description')}
        rows={3}
      />
    </FormRow>
  )
}

function TagsRow({ row }: { row: WizardCastDraft }) {
  return (
    <FormRow label={t('wizard:cast.editor.tags')}>
      <TagInput value={row.tags} onChange={(tags) => wizardStore.patchCast(row.id, { tags })} />
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
function SetAsLeadButton({ row, leadEntityId }: SetAsLeadButtonProps) {
  if (!canSetLead(row, leadEntityId)) return null
  return (
    <Button variant="secondary" size="sm" onPress={() => wizardStore.setLeadEntityId(row.id)}>
      <Text>{t('wizard:cast.setAsLead')}</Text>
    </Button>
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
      <FormRow label={t('wizard:cast.editor.voice')}>
        <Input
          value={row.voice}
          onChangeText={(voice) => wizardStore.patchCast(row.id, { voice })}
          placeholder={t('wizard:cast.editor.voicePlaceholder')}
          aria-label={t('wizard:cast.editor.voice')}
        />
      </FormRow>
      <FormRow label={t('wizard:cast.editor.traits')}>
        <TagInput
          value={row.traits}
          onChange={(traits) => wizardStore.patchCast(row.id, { traits })}
          maxCount={TRAITS_CAP}
        />
      </FormRow>
      <FormRow label={t('wizard:cast.editor.drives')}>
        <TagInput
          value={row.drives}
          onChange={(drives) => wizardStore.patchCast(row.id, { drives })}
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
                    wizardStore.patchCast(row.id, { visual: { ...row.visual, [field]: text } })
                  }
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
              onChange={(factionId) => wizardStore.patchCast(row.id, { factionId })}
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
              onChange={(parentLocationId) => wizardStore.patchCast(row.id, { parentLocationId })}
            />
            <FormRow label={t('wizard:cast.editor.condition')}>
              <Input
                value={row.condition}
                onChangeText={(condition) => wizardStore.patchCast(row.id, { condition })}
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
                onChangeText={(condition) => wizardStore.patchCast(row.id, { condition })}
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
          onChange={(agenda) => wizardStore.patchCast(row.id, { agenda })}
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
                onChangeText={(standing) => wizardStore.patchCast(row.id, { standing })}
                aria-label={t('wizard:cast.editor.standing')}
              />
            </FormRow>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </>
  )
}
