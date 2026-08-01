import * as PopoverPrimitive from '@rn-primitives/popover'
import { Check } from 'lucide-react-native'
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import LibColorPicker, { HueSlider, Panel1 } from 'reanimated-color-picker'

import { Button } from '@/components/ui/button'
import { DisabledReasonTooltip } from '@/components/ui/disabled-reason-tooltip'
import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { useDensity, type DensityValue } from '@/lib/density'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type ColorValue = string

type ColorPickerProps = {
  swatches: ColorValue[]
  value: ColorValue | null
  onChange: (next: ColorValue | null) => void
  fallbackColor: ColorValue
  fallbackLabel: string
  allowCustom?: boolean
  customWarning?: (hex: ColorValue) => ReactNode | null
  disabled?: boolean
  disabledReason?: string
  className?: string
  testID?: string
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const DEFAULT_CUSTOM_HEX = '#3b82f6'

function normalizeHex(input: string): string | null {
  const trimmed = input.trim()
  if (!HEX_PATTERN.test(trimmed)) return null
  if (trimmed.length === 4) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return trimmed.toLowerCase()
}

function eqColor(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a === b
  return a.toLowerCase() === b.toLowerCase()
}

// Dynamic per-swatch fill; pulled out so the style isn't an inline literal in JSX.
function fillStyle(color: string): ViewStyle {
  return { backgroundColor: color }
}

// YIQ contrast heuristic — converts the swatch background to perceived
// brightness and decides whether the overlaid Check should be dark or light.
function isLightColor(hex: string): boolean {
  const raw = hex.startsWith('#') ? hex.slice(1) : hex
  let r = 0
  let g = 0
  let b = 0
  if (raw.length === 3) {
    r = parseInt(raw[0]! + raw[0]!, 16)
    g = parseInt(raw[1]! + raw[1]!, 16)
    b = parseInt(raw[2]! + raw[2]!, 16)
  } else if (raw.length === 6) {
    r = parseInt(raw.slice(0, 2), 16)
    g = parseInt(raw.slice(2, 4), 16)
    b = parseInt(raw.slice(4, 6), 16)
  }
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128
}

// Slightly transparent so the Check reads as an overlay rather than a hard
// shape — keeps the swatch color legible while still clearly marking selection.
const CHECK_OVERLAY_OPACITY = 0.85

const SWATCH_SIZE_CLASSES: Record<DensityValue, string> = {
  compact: 'h-6 w-6',
  regular: 'h-7 w-7',
  comfortable: 'h-8 w-8',
}

const CHECK_ICON_PX: Record<DensityValue, number> = {
  compact: 12,
  regular: 14,
  comfortable: 16,
}

const STATIC_STYLES = StyleSheet.create({
  pickerWrapper: { width: '100%' },
  panel: { height: 160, borderRadius: 8 },
  hueSlider: { marginTop: 12 },
  pointerEventsNone: { pointerEvents: 'none' },
})

type SwatchKind = 'none' | 'curated' | 'custom-empty' | 'custom-filled'

type SwatchButtonProps = Omit<ComponentProps<typeof Pressable>, 'onPress' | 'aria-label'> & {
  color?: ColorValue
  selected: boolean
  kind: SwatchKind
  ariaLabel: string
  onPress: () => void
}

function SwatchButton({
  color,
  selected,
  kind,
  ariaLabel,
  onPress,
  disabled,
  ...slotProps
}: SwatchButtonProps) {
  const { resolved: density } = useDensity()
  const ringClass = selected ? 'border-border-strong' : 'border-border'
  const dashed = kind === 'none' ? 'border-dashed' : ''
  const isEmpty = kind === 'custom-empty'
  const showCheck = selected && !isEmpty && color != null
  const checkStyle = {
    color: color != null && isLightColor(color) ? '#000000' : '#ffffff',
    opacity: CHECK_OVERLAY_OPACITY,
  }

  return (
    <Pressable
      role="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      onPress={onPress}
      disabled={disabled}
      style={isEmpty || !color ? undefined : fillStyle(color)}
      className={cn(
        'items-center justify-center rounded-full border-2',
        SWATCH_SIZE_CLASSES[density],
        ringClass,
        dashed,
      )}
      {...slotProps}
    >
      {isEmpty ? <Text size="sm">+</Text> : null}
      {showCheck ? <Icon as={Check} size={CHECK_ICON_PX[density]} style={checkStyle} /> : null}
    </Pressable>
  )
}

type CustomEditorProps = {
  initial: ColorValue
  customWarning?: (hex: ColorValue) => ReactNode | null
  renderActions: (hex: ColorValue, valid: boolean) => ReactNode
  disabled: boolean
  disabledReason?: string
  copy: CustomColorCopy
}

type CustomColorCopy = {
  title: string
  hexLabel: string
  invalidHex: string
  pickLabel: string
  valueLabel: (hex: ColorValue) => string
  cancel: string
  apply: string
}

function CustomEditor({
  initial,
  customWarning,
  renderActions,
  disabled,
  disabledReason,
  copy,
}: CustomEditorProps) {
  const [localHex, setLocalHex] = useState<ColorValue>(initial.toLowerCase())
  const [hexInput, setHexInput] = useState<string>(initial.toLowerCase())

  useEffect(() => {
    const normalized = normalizeHex(hexInput)
    if (normalized && normalized !== localHex) {
      setLocalHex(normalized)
    }
  }, [hexInput, localHex])

  const inputValid = normalizeHex(hexInput) !== null
  const warning = customWarning?.(localHex) ?? null
  const previewStyle = inputValid ? fillStyle(localHex) : undefined

  return (
    <View className="flex-col gap-3">
      <Heading level={4}>{copy.title}</Heading>
      {/* The editor is portaled out of ColorPicker's wrapper, so it never
          inherits the outer disabled dimming — it has to carry its own. */}
      <View
        style={disabled ? STATIC_STYLES.pointerEventsNone : undefined}
        className={cn(disabled && 'opacity-50')}
      >
        <LibColorPicker
          value={localHex}
          onChangeJS={({ hex }) => {
            setLocalHex(hex.toLowerCase())
            setHexInput(hex.toLowerCase())
          }}
          style={STATIC_STYLES.pickerWrapper}
        >
          <Panel1 style={STATIC_STYLES.panel} />
          <HueSlider style={STATIC_STYLES.hueSlider} thumbShape="circle" />
        </LibColorPicker>
      </View>
      <View className="flex-row items-center gap-2">
        <View
          aria-hidden
          className="h-7 w-7 rounded-full border border-border"
          style={previewStyle}
        />
        <Input
          value={hexInput}
          onChangeText={setHexInput}
          placeholder={DEFAULT_CUSTOM_HEX}
          autoCapitalize="none"
          autoCorrect={false}
          aria-invalid={!inputValid}
          aria-label={copy.hexLabel}
          editable={!disabled}
          accessibilityHint={disabled ? disabledReason : undefined}
          className="flex-1"
        />
      </View>
      {!inputValid ? (
        <Text size="xs" className="text-danger">
          {copy.invalidHex}
        </Text>
      ) : null}
      {warning != null ? <View>{warning}</View> : null}
      {renderActions(localHex, inputValid)}
    </View>
  )
}

type CustomChipProps = {
  customHex: ColorValue | null
  open: boolean
  onOpenChange: (open: boolean) => void
  customWarning?: (hex: ColorValue) => ReactNode | null
  onCommit: (hex: ColorValue) => void
  copy: CustomColorCopy
  disabled?: boolean
  disabledReason?: string
}

function CustomPopoverApplyAction({
  disabled,
  disabledReason,
  valid,
  onPress,
  copy,
}: {
  disabled: boolean
  disabledReason?: string
  valid: boolean
  onPress: () => void
  copy: string
}) {
  return (
    <DisabledReasonTooltip reason={disabled ? disabledReason : undefined}>
      <PopoverPrimitive.Close asChild>
        <Button
          disabled={disabled || !valid}
          accessibilityHint={disabled ? disabledReason : undefined}
          onPress={onPress}
        >
          <Text>{copy}</Text>
        </Button>
      </PopoverPrimitive.Close>
    </DisabledReasonTooltip>
  )
}

function CustomChip({
  customHex,
  open,
  onOpenChange,
  customWarning,
  onCommit,
  copy,
  disabled,
  disabledReason,
}: CustomChipProps) {
  const tier = useTier()
  const filled = customHex != null
  const ariaLabel = filled ? copy.valueLabel(customHex) : copy.pickLabel
  const initial = customHex ?? DEFAULT_CUSTOM_HEX

  const trigger = (
    <SwatchButton
      color={filled ? customHex : undefined}
      selected={filled}
      kind={filled ? 'custom-filled' : 'custom-empty'}
      ariaLabel={ariaLabel}
      onPress={() => onOpenChange(true)}
      disabled={disabled}
      accessibilityHint={disabled ? disabledReason : undefined}
    />
  )

  if (tier === 'phone') {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={onOpenChange} ariaLabel={copy.title}>
          <SheetContent anchor="bottom" size="auto">
            <CustomEditor
              initial={initial}
              customWarning={customWarning}
              disabled={disabled === true}
              disabledReason={disabledReason}
              copy={copy}
              renderActions={(hex, valid) => (
                <View className="flex-row justify-end gap-2">
                  <Button variant="ghost" onPress={() => onOpenChange(false)}>
                    <Text>{copy.cancel}</Text>
                  </Button>
                  <Button
                    disabled={disabled || !valid}
                    disabledReason={disabled ? disabledReason : undefined}
                    onPress={() => {
                      onOpenChange(false)
                      onCommit(hex)
                    }}
                  >
                    <Text>{copy.apply}</Text>
                  </Button>
                </View>
              )}
            />
          </SheetContent>
        </Sheet>
      </>
    )
  }

  return (
    <Popover ariaLabel={copy.title}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72">
        <CustomEditor
          initial={initial}
          customWarning={customWarning}
          disabled={disabled === true}
          disabledReason={disabledReason}
          copy={copy}
          renderActions={(hex, valid) => (
            <View className="flex-row justify-end gap-2">
              <PopoverPrimitive.Close asChild>
                <Button variant="ghost">
                  <Text>{copy.cancel}</Text>
                </Button>
              </PopoverPrimitive.Close>
              <CustomPopoverApplyAction
                disabled={disabled === true}
                disabledReason={disabledReason}
                valid={valid}
                onPress={() => onCommit(hex)}
                copy={copy.apply}
              />
            </View>
          )}
        />
      </PopoverContent>
    </Popover>
  )
}

function ColorPicker({
  swatches,
  value,
  onChange,
  fallbackColor,
  fallbackLabel,
  allowCustom = false,
  customWarning,
  disabled,
  disabledReason,
  className,
  testID,
}: ColorPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)
  const customCopy: CustomColorCopy = {
    title: t('colorPicker.customColor'),
    hexLabel: t('colorPicker.hexColor'),
    invalidHex: t('colorPicker.invalidHex', { example: DEFAULT_CUSTOM_HEX }),
    pickLabel: t('colorPicker.pickCustomColor'),
    valueLabel: (hex) => t('colorPicker.customColorValue', { hex }),
    cancel: t('cancel'),
    apply: t('colorPicker.apply'),
  }

  const valueIsCurated = useMemo(
    () => value != null && swatches.some((s) => eqColor(s, value)),
    [swatches, value],
  )
  const customHex = value != null && !valueIsCurated ? value : null

  return (
    <View
      className={cn('flex-row flex-wrap items-center gap-2', disabled && 'opacity-50', className)}
      style={disabled ? STATIC_STYLES.pointerEventsNone : undefined}
      testID={testID}
    >
      <SwatchButton
        color={fallbackColor}
        selected={value === null}
        kind="none"
        ariaLabel={fallbackLabel}
        onPress={() => onChange(null)}
        disabled={disabled}
        accessibilityHint={disabled ? disabledReason : undefined}
      />
      {swatches.map((swatch) => (
        <SwatchButton
          key={swatch}
          color={swatch}
          selected={eqColor(value, swatch)}
          kind="curated"
          ariaLabel={swatch}
          onPress={() => onChange(swatch)}
          disabled={disabled}
          accessibilityHint={disabled ? disabledReason : undefined}
        />
      ))}
      {allowCustom ? (
        <CustomChip
          customHex={customHex}
          open={customOpen}
          onOpenChange={setCustomOpen}
          customWarning={customWarning}
          onCommit={(hex) => onChange(hex)}
          copy={customCopy}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      ) : null}
    </View>
  )
}

export { ColorPicker }
export type { ColorPickerProps, ColorValue }
