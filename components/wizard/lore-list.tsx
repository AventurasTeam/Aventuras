import { ChevronDown, Trash2 } from 'lucide-react-native'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { TagInput } from '@/components/compounds/tag-input'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import type { InjectionMode, WizardLoreDraft } from '@/lib/db'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { cn } from '@/lib/utils'

import { loreRowErrors, parsePriorityInput, PRIORITY_MAX, PRIORITY_MIN } from './step-world-logic'

export type LoreListProps = {
  rows: readonly WizardLoreDraft[]
  /**
   * From invalidLoreRowIds. Gates whether a row shows error state at all —
   * both the compact row and the editor derive their field-level messages
   * from `loreRowErrors`, but only display them when the row's id is here.
   */
  invalidIds: readonly string[]
  /**
   * Extra control rendered in the header row, before Add (e.g. step-world's
   * "Suggest lore" trigger) — keeps `handleAdd`'s expand-on-add ownership
   * inside this component instead of a second, divergent Add affordance.
   */
  headerAction?: ReactNode
}

const INJECTION_MODE_OPTIONS: SelectOption[] = [
  { value: 'always', label: t('wizard:world.lore.modes.always') },
  { value: 'auto', label: t('wizard:world.lore.modes.auto') },
  { value: 'disabled', label: t('wizard:world.lore.modes.disabled') },
]

function blank(value: string): boolean {
  return value.trim().length === 0
}

type Chip = { key: string; label: string }

function chipsFor(row: WizardLoreDraft): Chip[] {
  const chips: Chip[] = []
  if (!blank(row.category)) chips.push({ key: 'category', label: row.category.trim() })
  if (row.injectionMode !== 'auto') {
    chips.push({ key: 'mode', label: t(`wizard:world.lore.modes.${row.injectionMode}`) })
  }
  if (row.priority !== 0) {
    chips.push({ key: 'priority', label: `${t('wizard:world.lore.priority')} ${row.priority}` })
  }
  return chips
}

type LoreRowProps = {
  row: WizardLoreDraft
  invalid: boolean
  expanded: boolean
  onToggleExpanded: (id: string) => void
}

function LoreRow({ row, invalid, expanded, onToggleExpanded }: LoreRowProps) {
  // Holds the priority field's raw text only while it is mid-edit, so clearing
  // it leaves an empty box instead of snapping back to the stored number.
  // Cleared on blur so the field re-derives from the (clamped) stored value.
  const [priorityDraft, setPriorityDraft] = useState<string | null>(null)

  function handlePriorityChange(text: string) {
    const parsed = parsePriorityInput(text)
    if (parsed == null) {
      setPriorityDraft('')
      return
    }
    setPriorityDraft(String(parsed))
    wizardStore.patchLore(row.id, { priority: parsed })
  }

  const chips = expanded ? [] : chipsFor(row)
  // Gated by `invalid` (the invalidIds prop), not recomputed independently —
  // a row the parent doesn't flag as invalid shows no error anywhere, even
  // if title/body happen to be blank (see the LoreListProps doc above).
  const fieldErrors = invalid ? loreRowErrors(row) : []
  const titleBlank = fieldErrors.includes('title')
  const bodyBlank = fieldErrors.includes('body')
  const errorMessages = fieldErrors.map((field) => t(`wizard:world.lore.errors.${field}`))

  return (
    <View
      className={cn('rounded-md border bg-bg-base', invalid ? 'border-danger' : 'border-border')}
    >
      <View className="flex-row items-start gap-1">
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          aria-label={t(expanded ? 'wizard:world.lore.collapse' : 'wizard:world.lore.expand')}
          onPress={() => onToggleExpanded(row.id)}
          className="flex-1 flex-row items-start gap-2 py-row-y-lg pl-3"
        >
          <View className="min-w-0 flex-1 gap-1">
            <Text className="font-medium" numberOfLines={1}>
              {row.title.trim() || t('wizard:world.lore.untitled')}
            </Text>
            {!expanded ? (
              <>
                {!blank(row.body) ? (
                  <Text variant="muted" size="sm" numberOfLines={2}>
                    {row.body}
                  </Text>
                ) : null}
                {chips.length > 0 ? (
                  <View className="flex-row flex-wrap gap-1">
                    {chips.map((chip) => (
                      <Tag key={chip.key} tone="soft">
                        {chip.label}
                      </Tag>
                    ))}
                  </View>
                ) : null}
                {errorMessages.length > 0 ? (
                  <Text size="xs" className="text-danger">
                    {errorMessages.join(' ')}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
        </Pressable>
        <View className="flex-row items-start gap-1 pr-3 pt-row-y-lg">
          <IconAction
            icon={Trash2}
            label={t('wizard:world.lore.remove')}
            size="sm"
            variant="destructive"
            onPress={() => wizardStore.removeLore(row.id)}
          />
          {/* Redundant pointer affordance for the row-wide Pressable above, which
              stays the single control assistive tech sees — two buttons carrying
              one action would read as a duplicate. Rotation sits on this wrapper
              rather than the Icon so it never reaches react-native-svg. */}
          <Pressable
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            focusable={false}
            onPress={() => onToggleExpanded(row.id)}
            className="h-icon-action-sm w-icon-action-sm items-center justify-center"
          >
            <View className={cn(expanded && 'rotate-180')}>
              <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
            </View>
          </Pressable>
        </View>
      </View>
      {expanded ? (
        <View className="gap-4 px-3 pb-3">
          <FormRow
            label={t('wizard:world.lore.title')}
            error={titleBlank ? t('wizard:world.lore.errors.title') : undefined}
          >
            <Input
              value={row.title}
              onChangeText={(title) => wizardStore.patchLore(row.id, { title })}
              aria-label={t('wizard:world.lore.title')}
              aria-invalid={titleBlank}
            />
          </FormRow>
          <FormRow
            label={t('wizard:world.lore.body')}
            error={bodyBlank ? t('wizard:world.lore.errors.body') : undefined}
          >
            <Textarea
              value={row.body}
              onChangeText={(body) => wizardStore.patchLore(row.id, { body })}
              aria-label={t('wizard:world.lore.body')}
              aria-invalid={bodyBlank}
              rows={4}
            />
          </FormRow>
          <FormRow label={t('wizard:world.lore.category')}>
            <Input
              value={row.category}
              onChangeText={(category) => wizardStore.patchLore(row.id, { category })}
              placeholder={t('wizard:world.lore.categoryPlaceholder')}
              aria-label={t('wizard:world.lore.category')}
            />
          </FormRow>
          <Accordion type="single" collapsible defaultValue="">
            <AccordionItem value="more-options">
              <AccordionTrigger>
                <Text>{t('wizard:world.lore.moreOptions')}</Text>
              </AccordionTrigger>
              <AccordionContent className="gap-4">
                <FormRow label={t('wizard:world.lore.tags')}>
                  <TagInput
                    value={row.tags}
                    onChange={(tags) => wizardStore.patchLore(row.id, { tags })}
                  />
                </FormRow>
                <FormRow label={t('wizard:world.lore.injectionMode')}>
                  <Select
                    options={INJECTION_MODE_OPTIONS}
                    value={row.injectionMode}
                    onValueChange={(injectionMode) =>
                      wizardStore.patchLore(row.id, {
                        injectionMode: injectionMode as InjectionMode,
                      })
                    }
                  />
                </FormRow>
                <FormRow
                  label={t('wizard:world.lore.priority')}
                  hint={t('wizard:world.lore.priorityHint', {
                    min: PRIORITY_MIN,
                    max: PRIORITY_MAX,
                  })}
                >
                  <Input
                    value={priorityDraft ?? String(row.priority)}
                    onChangeText={handlePriorityChange}
                    onBlur={() => setPriorityDraft(null)}
                    keyboardType="number-pad"
                    aria-label={t('wizard:world.lore.priority')}
                    className="w-24"
                  />
                </FormRow>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </View>
      ) : null}
    </View>
  )
}

export function LoreList({ rows, invalidIds, headerAction }: LoreListProps) {
  // Ephemeral, component-local — never reaches the persisted blob. Keyed by id
  // and pruned below; a stale id would re-expand a recycled row (no-harmless-id-leaks.md).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Prunes only — new-id auto-expand lives in handleAdd, not here, so a
  // hydrated resume or importLore batch never pops an editor open unasked.
  useEffect(() => {
    const currentIds = new Set(rows.map((r) => r.id))
    setExpanded((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const id of prev) {
        if (!currentIds.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [rows])

  const invalidSet = useMemo(() => new Set(invalidIds), [invalidIds])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleAdd() {
    const id = wizardStore.addLore()
    setExpanded((prev) => new Set(prev).add(id))
  }

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between">
        <Heading level={2}>{t('wizard:world.lore.sectionLabel')}</Heading>
        <View className="flex-row items-center gap-2">
          {headerAction}
          <Button variant="ghost" onPress={handleAdd}>
            <Text>{t('wizard:world.lore.add')}</Text>
          </Button>
        </View>
      </View>
      {rows.length === 0 ? (
        <Text variant="muted" size="sm">
          {t('wizard:world.lore.empty')}
        </Text>
      ) : (
        <View className="gap-2">
          {rows.map((row) => (
            <LoreRow
              key={row.id}
              row={row}
              invalid={invalidSet.has(row.id)}
              expanded={expanded.has(row.id)}
              onToggleExpanded={toggleExpanded}
            />
          ))}
        </View>
      )}
    </View>
  )
}
