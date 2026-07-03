import * as RadioGroupBase from '@rn-primitives/radio-group'
import { Info } from 'lucide-react-native'
import { Platform, View } from 'react-native'

import { FormRow } from '@/components/compounds/form-row'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { cn } from '@/lib/utils'

import { needsLead } from './step-frame-logic'

type FrameOption = { value: string; label: string; description: string }

const MODE_OPTIONS: FrameOption[] = [
  {
    value: 'adventure',
    label: t('wizard:frame.mode.adventure.label'),
    description: t('wizard:frame.mode.adventure.description'),
  },
  {
    value: 'creative',
    label: t('wizard:frame.mode.creative.label'),
    description: t('wizard:frame.mode.creative.description'),
  },
]

const NARRATION_OPTIONS: FrameOption[] = [
  {
    value: 'first',
    label: t('wizard:frame.narration.first.label'),
    description: t('wizard:frame.narration.first.description'),
  },
  {
    value: 'second',
    label: t('wizard:frame.narration.second.label'),
    description: t('wizard:frame.narration.second.description'),
  },
  {
    value: 'third',
    label: t('wizard:frame.narration.third.label'),
    description: t('wizard:frame.narration.third.description'),
  },
]

// Select's segment branch (components/ui/select.tsx) renders label-only
// cells; wizard.md's step 1 calls for two-line cells (label + explanation)
// visible on every option at once, not just the selected one. That's a
// different contract from what Select's segment mode implements today, so
// this stays a small local control instead of a Select consumer.
function FrameSegment({
  options,
  value,
  onValueChange,
}: {
  options: FrameOption[]
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <RadioGroupBase.Root
      value={value}
      onValueChange={onValueChange}
      className="w-full flex-row overflow-hidden rounded-md border border-border-strong bg-bg-base"
    >
      {options.map((opt, i) => {
        const selected = opt.value === value
        return (
          <RadioGroupBase.Item
            key={opt.value}
            value={opt.value}
            className={cn(
              'flex-1 items-center justify-center gap-0.5 px-3 py-2.5',
              i > 0 && 'border-l border-l-border-strong',
              selected ? 'bg-accent' : 'active:bg-tint-press',
              Platform.select({
                web: cn(
                  !selected && 'hover:bg-tint-hover',
                  'focus-visible:ring-focus-ring/50 cursor-pointer outline-none focus-visible:ring-[3px]',
                ),
              }),
            )}
          >
            <Text size="sm" className={cn('text-center font-medium', selected && 'text-accent-fg')}>
              {opt.label}
            </Text>
            <Text
              size="xs"
              className={cn(
                'text-center',
                selected ? 'text-accent-fg opacity-80' : 'text-fg-muted',
              )}
            >
              {opt.description}
            </Text>
          </RadioGroupBase.Item>
        )
      })}
    </RadioGroupBase.Root>
  )
}

function LeadRequirementNotice() {
  return (
    <View
      role="status"
      aria-live="polite"
      className="flex-row items-start gap-2 rounded-r-md border-l-4 border-l-border-strong bg-bg-sunken px-3 py-2.5"
    >
      <Icon as={Info} size="sm" className="mt-0.5 shrink-0 text-fg-muted" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {t('wizard:frame.leadNotice')}
      </Text>
    </View>
  )
}

export function StepFrame() {
  const mode = wizardStore.useWizard((s) => s.state.definition.mode)
  const narration = wizardStore.useWizard((s) => s.state.definition.narration)
  const leadName = wizardStore.useWizard((s) => s.state.leadName)

  const lead = needsLead(mode, narration)

  return (
    <View className="gap-6">
      <Heading level={1}>{t('wizard:frame.heading')}</Heading>

      <FormRow label={t('wizard:frame.mode.label')}>
        <FrameSegment
          options={MODE_OPTIONS}
          value={mode}
          onValueChange={(next) =>
            wizardStore.patchDefinition({ mode: next as 'adventure' | 'creative' })
          }
        />
      </FormRow>

      <FormRow label={t('wizard:frame.narration.label')}>
        <FrameSegment
          options={NARRATION_OPTIONS}
          value={narration}
          onValueChange={(next) =>
            wizardStore.patchDefinition({ narration: next as 'first' | 'second' | 'third' })
          }
        />
      </FormRow>

      {lead ? (
        <>
          <LeadRequirementNotice />
          <FormRow label={t('wizard:frame.leadName.label')}>
            <Input
              value={leadName}
              onChangeText={wizardStore.setLeadName}
              placeholder={t('wizard:frame.leadName.placeholder')}
            />
          </FormRow>
        </>
      ) : null}
    </View>
  )
}

export type { FrameOption }
