import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native'
import LibColorPicker, { HueSlider, Panel1 } from 'reanimated-color-picker'

import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
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
  className?: string
  testID?: string
}

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

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

const STATIC_STYLES = StyleSheet.create({
  pickerWrapper: { width: '100%' },
  panel: { height: 160, borderRadius: 8 },
  hueSlider: { marginTop: 12 },
  pointerEventsNone: { pointerEvents: 'none' },
})

type SwatchKind = 'none' | 'curated' | 'custom-empty' | 'custom-filled'

type SwatchButtonProps = {
  color?: ColorValue
  selected: boolean
  kind: SwatchKind
  ariaLabel: string
  onPress: () => void
  disabled?: boolean
}

function SwatchButton({ color, selected, kind, ariaLabel, onPress, disabled }: SwatchButtonProps) {
  const ringClass = selected ? 'border-border-strong' : 'border-border'
  const dashed = kind === 'none' ? 'border-dashed' : ''
  const isEmpty = kind === 'custom-empty'

  return (
    <Pressable
      role="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      onPress={onPress}
      disabled={disabled}
      style={isEmpty || !color ? undefined : fillStyle(color)}
      className={cn('h-7 w-7 items-center justify-center rounded-full border-2', ringClass, dashed)}
    >
      {isEmpty ? <Text size="sm">+</Text> : null}
    </Pressable>
  )
}

type CustomEditorProps = {
  initial: ColorValue
  customWarning?: (hex: ColorValue) => ReactNode | null
  renderActions: (hex: ColorValue, valid: boolean) => ReactNode
}

function CustomEditor({ initial, customWarning, renderActions }: CustomEditorProps) {
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
      <Heading level={4}>Custom color</Heading>
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
      <View className="flex-row items-center gap-2">
        <View
          aria-hidden
          className="h-7 w-7 rounded-full border border-border"
          style={previewStyle}
        />
        <Input
          value={hexInput}
          onChangeText={setHexInput}
          placeholder="#3b82f6"
          autoCapitalize="none"
          autoCorrect={false}
          aria-invalid={!inputValid}
          aria-label="Hex color"
          className="flex-1"
        />
      </View>
      {!inputValid ? (
        <Text size="xs" className="text-danger">
          Enter a hex color, e.g. #3b82f6
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
  disabled?: boolean
}

const DEFAULT_CUSTOM_HEX = '#3b82f6'

function CustomChip({
  customHex,
  open,
  onOpenChange,
  customWarning,
  onCommit,
  disabled,
}: CustomChipProps) {
  const tier = useTier()
  const filled = customHex != null
  const ariaLabel = filled ? `Custom color ${customHex}` : 'Pick custom color'
  const initial = customHex ?? DEFAULT_CUSTOM_HEX

  const trigger = (
    <SwatchButton
      color={filled ? customHex : undefined}
      selected={filled}
      kind={filled ? 'custom-filled' : 'custom-empty'}
      ariaLabel={ariaLabel}
      onPress={() => onOpenChange(true)}
      disabled={disabled}
    />
  )

  if (tier === 'phone') {
    return (
      <>
        {trigger}
        <Sheet open={open} onOpenChange={onOpenChange} ariaLabel="Custom color">
          <SheetContent anchor="bottom" size="short">
            <CustomEditor
              initial={initial}
              customWarning={customWarning}
              renderActions={(hex, valid) => (
                <View className="flex-row justify-end gap-2">
                  <Button variant="ghost" onPress={() => onOpenChange(false)}>
                    <Text>Cancel</Text>
                  </Button>
                  <Button
                    disabled={!valid}
                    onPress={() => {
                      onOpenChange(false)
                      onCommit(hex)
                    }}
                  >
                    <Text>Apply</Text>
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
    <Popover ariaLabel="Custom color">
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72">
        <CustomEditor
          initial={initial}
          customWarning={customWarning}
          renderActions={(hex, valid) => (
            <View className="flex-row justify-end gap-2">
              <Button variant="ghost" onPress={() => onOpenChange(false)}>
                <Text>Cancel</Text>
              </Button>
              <Button disabled={!valid} onPress={() => onCommit(hex)}>
                <Text>Apply</Text>
              </Button>
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
  className,
  testID,
}: ColorPickerProps) {
  const [customOpen, setCustomOpen] = useState(false)

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
        />
      ))}
      {allowCustom ? (
        <CustomChip
          customHex={customHex}
          open={customOpen}
          onOpenChange={setCustomOpen}
          customWarning={customWarning}
          onCommit={(hex) => onChange(hex)}
          disabled={disabled}
        />
      ) : null}
    </View>
  )
}

export { ColorPicker }
export type { ColorPickerProps, ColorValue }
