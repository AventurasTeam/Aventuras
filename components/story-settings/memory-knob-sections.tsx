import { useState, type ReactNode } from 'react'
import { View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { NumberInput } from '@/components/compounds/number-input'
import { SwitchRow } from '@/components/compounds/switch-row'
import { Chip } from '@/components/ui/chip'
import { Select } from '@/components/ui/select'
import { Stepper } from '@/components/ui/stepper'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'

import {
  BUDGET_KEYS,
  cadenceOverlap,
  CHAPTER_THRESHOLD_PRESETS,
  CLASSIFIER_CONTEXT_MAX,
  CLASSIFIER_CONTEXT_MIN,
  KNOB_RULES,
  thresholdPreset,
  type MemoryKnobsDraft,
  type MemoryKnobsProblem,
} from './memory-knobs'

type MemoryKnobSectionProps = {
  draft: MemoryKnobsDraft
  /** The stored values; a toggle that hides or greys an invalid field reverts it to these. */
  baseline: MemoryKnobsDraft
  onChange: (next: MemoryKnobsDraft) => void
  /** The draft's first validation problem; only the field that owns it shows the message. */
  problem: MemoryKnobsProblem | null
  disabled: boolean
  disabledReason?: string
}

function SectionTitle({ children }: { children: string }) {
  return <Text className="font-semibold">{children}</Text>
}

function invalidCopy(problem: MemoryKnobsProblem) {
  return t(`storySettings:memory.knobs.invalid.${problem}`)
}

// A hidden or greyed field can't be fixed, so an invalid value left there would block the save
// out of reach. The stored value is the fallback because every app write passes these same rules
// on the way in — the schema is looser than they are, so it is not what makes that safe.
function validOrStored(
  rule: (value: number | null) => boolean,
  value: number | null,
  stored: number | null,
) {
  return rule(value) ? value : stored
}

type KnobFieldProps = {
  label: string
  hint?: string
  /** Its rule drives the border; its message shows only while it is the draft's `problem`. */
  owns: MemoryKnobsProblem
  problem: MemoryKnobsProblem | null
  testID: string
  value: number | null
  onChange: (next: number | null) => void
  integer?: boolean
  /** Accessible name; defaults to `label`. */
  inputLabel?: string
  disabled: boolean
  disabledReason?: string
  /** Set only while a mode greys the field; that toggle must first revert an invalid value. */
  inactiveReason?: string
  before?: ReactNode
  after?: ReactNode
}

function KnobField({
  label,
  hint,
  owns,
  problem,
  testID,
  value,
  onChange,
  integer,
  inputLabel = label,
  disabled,
  disabledReason,
  inactiveReason,
  before,
  after,
}: KnobFieldProps) {
  return (
    <FormRow label={label} hint={hint} error={problem === owns ? invalidCopy(owns) : undefined}>
      <View className="gap-2">
        {before}
        <NumberInput
          testID={testID}
          label={inputLabel}
          value={value}
          onChange={onChange}
          integer={integer}
          invalid={!KNOB_RULES[owns](value)}
          disabled={disabled || inactiveReason != null}
          disabledReason={disabled ? disabledReason : inactiveReason}
        />
        {after}
      </View>
    </FormRow>
  )
}

export function ChapterCloseSection({
  draft,
  onChange,
  problem,
  disabled,
  disabledReason,
}: MemoryKnobSectionProps) {
  const threshold = draft.chapterTokenThreshold
  // `Custom…` carries no value, so pressing it on a preset only flips the chips. The pin
  // holds that value: any change to it (typing, Discard) releases it, during render.
  const [customPinnedAt, setCustomPinnedAt] = useState<number | null>(null)
  if (customPinnedAt != null && customPinnedAt !== threshold) setCustomPinnedAt(null)
  const selected = customPinnedAt != null ? 'custom' : thresholdPreset(threshold)

  return (
    <View className="gap-3">
      <SectionTitle>{t('storySettings:memory.knobs.chapterClose')}</SectionTitle>
      <KnobField
        label={t('storySettings:memory.knobs.threshold')}
        hint={t('storySettings:memory.knobs.thresholdHint')}
        owns="threshold"
        problem={problem}
        testID="memory-threshold"
        inputLabel={t('storySettings:memory.knobs.thresholdTokens')}
        value={threshold}
        onChange={(chapterTokenThreshold) => onChange({ ...draft, chapterTokenThreshold })}
        disabled={disabled}
        disabledReason={disabledReason}
        before={
          <View className="flex-row flex-wrap gap-2">
            {CHAPTER_THRESHOLD_PRESETS.map((preset) => (
              <Chip
                key={preset.id}
                selected={selected === preset.id}
                disabled={disabled}
                onPress={() => {
                  setCustomPinnedAt(null)
                  onChange({ ...draft, chapterTokenThreshold: preset.tokens })
                }}
              >
                <Text size="xs">{t(`storySettings:memory.knobs.preset.${preset.id}`)}</Text>
              </Chip>
            ))}
            <Chip
              selected={selected === 'custom'}
              disabled={disabled}
              onPress={() => setCustomPinnedAt(threshold)}
            >
              <Text size="xs">{t('storySettings:memory.knobs.preset.custom')}</Text>
            </Chip>
          </View>
        }
      />
      <SwitchRow
        label={t('storySettings:memory.knobs.autoClose')}
        hint={t('storySettings:memory.knobs.autoCloseHint')}
        checked={draft.chapterAutoClose}
        onCheckedChange={(chapterAutoClose) => onChange({ ...draft, chapterAutoClose })}
        disabled={disabled}
        disabledReason={disabledReason}
      />
    </View>
  )
}

export function PromptContextSection({
  draft,
  baseline,
  onChange,
  problem,
  disabled,
  disabledReason,
}: MemoryKnobSectionProps) {
  const fullMode = draft.fullChapterInBuffer
  const threshold = draft.chapterTokenThreshold
  return (
    <View className="gap-3">
      <SectionTitle>{t('storySettings:memory.knobs.promptContext')}</SectionTitle>
      <SwitchRow
        label={t('storySettings:memory.knobs.fullChapter')}
        hint={
          KNOB_RULES.threshold(threshold)
            ? t('storySettings:memory.knobs.fullChapterHint', { tokens: threshold })
            : t('storySettings:memory.knobs.fullChapterHintPlain')
        }
        checked={fullMode}
        onCheckedChange={(fullChapterInBuffer) =>
          onChange({
            ...draft,
            fullChapterInBuffer,
            partialChapterBuffer: fullChapterInBuffer
              ? validOrStored(
                  KNOB_RULES.partialBuffer,
                  draft.partialChapterBuffer,
                  baseline.partialChapterBuffer,
                )
              : draft.partialChapterBuffer,
          })
        }
        disabled={disabled}
        disabledReason={disabledReason}
      />
      <KnobField
        label={t('storySettings:memory.knobs.partialBuffer')}
        hint={
          fullMode
            ? t('storySettings:memory.knobs.partialBufferIgnored')
            : t('storySettings:memory.knobs.partialBufferHint')
        }
        owns="partialBuffer"
        problem={problem}
        testID="memory-partial-buffer"
        value={draft.partialChapterBuffer}
        onChange={(partialChapterBuffer) => onChange({ ...draft, partialChapterBuffer })}
        disabled={disabled}
        disabledReason={disabledReason}
        inactiveReason={fullMode ? t('storySettings:memory.knobs.partialBufferIgnored') : undefined}
      />
      <KnobField
        label={t('storySettings:memory.knobs.protectedBuffer')}
        hint={t('storySettings:memory.knobs.protectedBufferHint')}
        owns="protectedBuffer"
        problem={problem}
        testID="memory-protected-buffer"
        value={draft.protectedBuffer}
        onChange={(protectedBuffer) => onChange({ ...draft, protectedBuffer })}
        disabled={disabled}
        disabledReason={disabledReason}
      />
      <FormRow
        label={t('storySettings:memory.knobs.classifierContext')}
        hint={t('storySettings:memory.knobs.classifierContextHint')}
      >
        <Stepper
          testID="memory-classifier-context"
          value={draft.classifierContextEntries}
          min={CLASSIFIER_CONTEXT_MIN}
          max={CLASSIFIER_CONTEXT_MAX}
          onChange={(classifierContextEntries) => onChange({ ...draft, classifierContextEntries })}
          label={t('storySettings:memory.knobs.classifierContext')}
          decrementLabel={t('storySettings:memory.knobs.contextDecrement')}
          incrementLabel={t('storySettings:memory.knobs.contextIncrement')}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </FormRow>
    </View>
  )
}

export function ClassifierCadenceSection({
  draft,
  onChange,
  problem,
  disabled,
  disabledReason,
}: MemoryKnobSectionProps) {
  const partial = draft.partialChapterBuffer
  const cadence = draft.classifierCadence
  // Full mode keeps the whole chapter in context, so no turn can slide out unclassified.
  const overlap =
    !draft.fullChapterInBuffer && KNOB_RULES.partialBuffer(partial) && KNOB_RULES.cadence(cadence)
      ? cadenceOverlap(partial, cadence)
      : null

  return (
    <View className="gap-3">
      <SectionTitle>{t('storySettings:memory.knobs.classifier')}</SectionTitle>
      <KnobField
        label={t('storySettings:memory.knobs.cadence')}
        hint={t('storySettings:memory.knobs.cadenceHint')}
        owns="cadence"
        problem={problem}
        testID="memory-cadence"
        value={cadence}
        onChange={(classifierCadence) => onChange({ ...draft, classifierCadence })}
        disabled={disabled}
        disabledReason={disabledReason}
        after={
          overlap != null ? (
            <View testID="memory-cadence-indicator" className="items-start">
              {overlap >= 0 ? (
                <Text testID="memory-cadence-overlap" size="xs" variant="muted">
                  {t('storySettings:memory.knobs.cadenceOverlap', { count: overlap })}
                </Text>
              ) : (
                <View testID="memory-cadence-warning" className="items-start gap-1">
                  <Tag tone="warning">
                    <Text size="xs">{t('storySettings:memory.knobs.cadenceWarningChip')}</Text>
                  </Tag>
                  <Text size="xs" variant="muted">
                    {t('storySettings:memory.knobs.cadenceWarning')}
                  </Text>
                </View>
              )}
            </View>
          ) : null
        }
      />
    </View>
  )
}

export function RetrievalBudgetsSection({
  draft,
  onChange,
  problem,
  disabled,
  disabledReason,
}: MemoryKnobSectionProps) {
  const budgets = draft.retrievalBudgets
  const badKeys = BUDGET_KEYS.filter((key) => !KNOB_RULES.budget(budgets[key]))
  // One problem covers all five inputs, so only the first bad one carries its message.
  const messageKey = problem === 'budget' ? badKeys[0] : undefined

  return (
    <View className="gap-3">
      <SectionTitle>{t('storySettings:memory.knobs.budgets')}</SectionTitle>
      <Text size="sm" variant="muted">
        {t('storySettings:memory.knobs.budgetsHint')}
      </Text>
      {BUDGET_KEYS.map((key) => (
        <FormRow
          key={key}
          label={t(`storySettings:memory.knobs.budget.${key}`)}
          error={key === messageKey ? invalidCopy('budget') : undefined}
        >
          <NumberInput
            testID={`memory-budget-${key}`}
            label={t(`storySettings:memory.knobs.budget.${key}`)}
            value={budgets[key]}
            onChange={(value) =>
              onChange({ ...draft, retrievalBudgets: { ...budgets, [key]: value } })
            }
            invalid={badKeys.includes(key)}
            disabled={disabled}
            disabledReason={disabledReason}
          />
        </FormRow>
      ))}
      {badKeys.length === 0 ? (
        <Text testID="memory-budget-total" size="sm" className="font-medium">
          {t('storySettings:memory.knobs.budgetTotal', {
            tokens: BUDGET_KEYS.reduce((sum, key) => sum + (budgets[key] ?? 0), 0),
          })}
        </Text>
      ) : null}
    </View>
  )
}

export function KeywordRetrievalSection({
  draft,
  baseline,
  onChange,
  problem,
  disabled,
  disabledReason,
}: MemoryKnobSectionProps) {
  const keyword = draft.keywordRetrieval
  const stored = baseline.keywordRetrieval
  const setKeyword = (patch: Partial<MemoryKnobsDraft['keywordRetrieval']>) =>
    onChange({ ...draft, keywordRetrieval: { ...keyword, ...patch } })

  return (
    <View className="gap-3">
      <SectionTitle>{t('storySettings:memory.knobs.keyword')}</SectionTitle>
      <FormRow label={t('storySettings:memory.knobs.keywordMode')}>
        <Select
          mode="radio"
          label={t('storySettings:memory.knobs.keywordMode')}
          options={[
            {
              value: 'boost',
              label: t('storySettings:memory.knobs.keywordModeOption.boost'),
              description: t('storySettings:memory.knobs.keywordModeHint.boost'),
            },
            {
              value: 'inject',
              label: t('storySettings:memory.knobs.keywordModeOption.inject'),
              description: t('storySettings:memory.knobs.keywordModeHint.inject'),
            },
          ]}
          value={keyword.mode}
          onValueChange={(mode) =>
            setKeyword(
              mode === 'inject'
                ? { mode: 'inject' }
                : {
                    mode: 'boost',
                    budgetShare: validOrStored(
                      KNOB_RULES.budgetShare,
                      keyword.budgetShare,
                      stored.budgetShare,
                    ),
                    cascadeMaxDepth: validOrStored(
                      KNOB_RULES.cascadeDepth,
                      keyword.cascadeMaxDepth,
                      stored.cascadeMaxDepth,
                    ),
                  },
            )
          }
          disabled={disabled}
        />
      </FormRow>
      <KnobField
        label={t('storySettings:memory.knobs.scanEntries')}
        hint={t('storySettings:memory.knobs.scanEntriesHint')}
        owns="scanEntries"
        problem={problem}
        testID="memory-keyword-scan"
        value={keyword.scanEntries}
        onChange={(scanEntries) => setKeyword({ scanEntries })}
        disabled={disabled}
        disabledReason={disabledReason}
      />
      {keyword.mode === 'inject' ? (
        <View testID="memory-keyword-inject-controls" className="gap-3">
          <KnobField
            label={t('storySettings:memory.knobs.budgetShare')}
            hint={t('storySettings:memory.knobs.budgetShareHint')}
            owns="budgetShare"
            problem={problem}
            testID="memory-keyword-share"
            integer={false}
            value={keyword.budgetShare}
            onChange={(budgetShare) => setKeyword({ budgetShare })}
            disabled={disabled}
            disabledReason={disabledReason}
          />
          <SwitchRow
            label={t('storySettings:memory.knobs.cascade')}
            hint={t('storySettings:memory.knobs.cascadeHint')}
            checked={keyword.cascade}
            onCheckedChange={(cascade) =>
              setKeyword(
                cascade
                  ? { cascade }
                  : {
                      cascade,
                      cascadeMaxDepth: validOrStored(
                        KNOB_RULES.cascadeDepth,
                        keyword.cascadeMaxDepth,
                        stored.cascadeMaxDepth,
                      ),
                    },
              )
            }
            disabled={disabled}
            disabledReason={disabledReason}
          />
          <KnobField
            label={t('storySettings:memory.knobs.cascadeMaxDepth')}
            owns="cascadeDepth"
            problem={problem}
            testID="memory-keyword-cascade-depth"
            value={keyword.cascadeMaxDepth}
            onChange={(cascadeMaxDepth) => setKeyword({ cascadeMaxDepth })}
            disabled={disabled}
            disabledReason={disabledReason}
            inactiveReason={
              keyword.cascade
                ? undefined
                : t('storySettings:memory.knobs.cascadeMaxDepthNeedsCascade')
            }
          />
        </View>
      ) : null}
    </View>
  )
}

export type { MemoryKnobSectionProps }
