import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { ProviderCapabilities, StorySettings } from '@/lib/db'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'
import { cn } from '@/lib/utils'

import {
  dimLadder,
  disclosureVisible,
  storagePreviewBytes,
  suggestedDim,
  validateCustomDim,
} from './memory-cost-logic'

type MemoryCostDisclosureProps = {
  embeddingBackend: StorySettings['embeddingBackend']
  capabilities: ProviderCapabilities | undefined
}

function formatStorage(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`
  return `${Math.round(bytes / 1_000_000)} MB`
}

type RadioRowProps = {
  label: string
  selected: boolean
  suggested: boolean
  preview?: string
  onSelect: () => void
}

function RadioRow({ label, selected, suggested, preview, onSelect }: RadioRowProps) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onSelect}
      className="flex-row items-center gap-3 py-row-y-sm"
    >
      <View
        className={cn(
          'h-4 w-4 items-center justify-center rounded-full border',
          selected ? 'border-accent' : 'border-border-strong',
        )}
      >
        {selected ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}
      </View>
      <Text className="flex-1 text-sm text-fg-primary">{label}</Text>
      {preview != null ? (
        <Text size="xs" variant="muted">
          {preview}
        </Text>
      ) : null}
      {suggested ? (
        <Text size="xs" className="text-accent">
          {t('wizard:memoryCost.suggested')}
        </Text>
      ) : null}
    </Pressable>
  )
}

export function MemoryCostDisclosure({
  embeddingBackend,
  capabilities,
}: MemoryCostDisclosureProps) {
  const visible = disclosureVisible({ embeddingBackend }, capabilities)
  const platform = useTier() === 'phone' ? 'mobile' : 'desktop'
  const effectiveDim = wizardStore.useWizard((s) => s.state.effectiveDim)
  const touched = wizardStore.useWizard((s) => s.state.effectiveDimTouched)

  const ladder = useMemo(() => dimLadder(capabilities), [capabilities])
  const suggestion = useMemo(() => suggestedDim(ladder, platform), [ladder, platform])

  const [expanded, setExpanded] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  // Seed from a stored off-ladder dim so a remount (step nav) shows the custom
  // input already filled rather than blank while the custom row reads selected.
  const [customRaw, setCustomRaw] = useState(() =>
    effectiveDim != null && !ladder.includes(effectiveDim) ? String(effectiveDim) : '',
  )
  const [customError, setCustomError] = useState<string | null>(null)

  // Platform-suggested pre-selection, once per wizard session. Two gates, both
  // load-bearing: the PERSISTED `touched` flag survives step-nav remounts so a
  // deliberate Native pick is not re-suggested, and the ref stops the effect
  // re-firing within one mount (a desktop suggestion is null, and writing null
  // marks touched).
  const preselectedRef = useRef(false)
  useEffect(() => {
    if (!visible || touched || preselectedRef.current) return
    preselectedRef.current = true
    if (suggestion != null) wizardStore.setEffectiveDim(suggestion)
    else wizardStore.setEffectiveDim(null)
  }, [visible, touched, suggestion])

  const onLadder = effectiveDim != null && ladder.includes(effectiveDim)
  const isCustomValue = effectiveDim != null && !onLadder
  const customActive = customOpen || isCustomValue

  // An unparseable draft must not outlive the field that produced it. The custom
  // input renders only while it is the active choice, so a hidden disclosure — or
  // a step-nav remount landing on a ladder pick — would otherwise block Finish
  // over an error message that is nowhere on screen.
  useEffect(() => {
    if (!visible || !customActive) wizardStore.setCustomDimInvalid(false)
  }, [visible, customActive])

  if (!visible) return null

  const headerSelection =
    effectiveDim != null
      ? t('wizard:memoryCost.headerDim', { dim: effectiveDim })
      : t('wizard:memoryCost.headerNative')

  const selectLadderDim = (dim: number) => {
    setCustomOpen(false)
    setCustomError(null)
    wizardStore.setEffectiveDim(dim)
  }

  const selectNative = () => {
    setCustomOpen(false)
    setCustomError(null)
    wizardStore.setEffectiveDim(null)
  }

  const openCustom = () => {
    setCustomOpen(true)
    setCustomError(null)
  }

  const onCustomChange = (raw: string) => {
    setCustomRaw(raw)
    const result = validateCustomDim(raw)
    if (result.ok) {
      setCustomError(null)
      wizardStore.setEffectiveDim(result.dim)
    } else {
      setCustomError(t('wizard:memoryCost.customError'))
      // The store only ever receives a VALID dim, so the previous one is still
      // sitting there — flag the draft as unparseable or Finish would commit a
      // number the field is no longer showing.
      wizardStore.setCustomDimInvalid(true)
    }
  }

  const previewLabel = (dim: number) =>
    t('wizard:memoryCost.storagePreview', { size: formatStorage(storagePreviewBytes(dim)) })

  const customPreview =
    customActive && validateCustomDim(customRaw).ok ? previewLabel(Number(customRaw)) : undefined

  return (
    <View testID="memory-cost-disclosure" className="rounded-md border border-border">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((prev) => !prev)}
        className="flex-row items-center gap-2 px-3 py-row-y-md"
      >
        <Icon as={expanded ? ChevronDown : ChevronRight} size="sm" className="text-fg-muted" />
        <Text className="flex-1 text-sm font-medium text-fg-primary">
          {t('wizard:memoryCost.header')} {'—'} {headerSelection}
        </Text>
      </Pressable>

      {expanded ? (
        <View className="gap-3 border-t border-border px-3 py-row-y-md">
          <Text size="sm" variant="muted">
            {t('wizard:memoryCost.body')}
          </Text>

          <Text className="text-sm font-medium text-fg-primary">
            {t('wizard:memoryCost.effectiveDimLabel')}
          </Text>

          <View
            accessibilityRole="radiogroup"
            aria-label={t('wizard:memoryCost.effectiveDimLabel')}
          >
            {ladder.map((dim) => (
              <RadioRow
                key={dim}
                label={t('wizard:memoryCost.dimOption', { dim })}
                selected={!customActive && onLadder && effectiveDim === dim}
                suggested={suggestion === dim}
                preview={previewLabel(dim)}
                onSelect={() => selectLadderDim(dim)}
              />
            ))}
            <RadioRow
              label={t('wizard:memoryCost.nativeOption')}
              selected={!customActive && effectiveDim == null}
              suggested={suggestion == null}
              onSelect={selectNative}
            />
            <RadioRow
              label={t('wizard:memoryCost.customOption')}
              selected={customActive}
              suggested={false}
              preview={customPreview}
              onSelect={openCustom}
            />
          </View>

          {customActive ? (
            <View className="gap-1">
              <Input
                testID="memory-cost-custom"
                value={customRaw}
                onChangeText={onCustomChange}
                onFocus={openCustom}
                keyboardType="number-pad"
                placeholder={t('wizard:memoryCost.customPlaceholder')}
                aria-label={t('wizard:memoryCost.customOption')}
                aria-invalid={customError != null}
              />
              {customError != null ? (
                <Text size="xs" className="text-danger">
                  {customError}
                </Text>
              ) : null}
              <Text size="xs" variant="muted">
                {t('wizard:memoryCost.customCaveat')}
              </Text>
            </View>
          ) : null}

          <Text size="xs" variant="muted">
            {t('wizard:memoryCost.footer')}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

export type { MemoryCostDisclosureProps }
