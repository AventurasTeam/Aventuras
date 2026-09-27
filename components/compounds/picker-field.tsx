import { ExternalLink, X } from 'lucide-react-native'
import { useCallback, useRef, type ReactElement, type Ref, type RefCallback } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import type { TriggerProps } from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type PickerFieldProps = TriggerProps & {
  /** The committed value's rendering; shown only while `hasValue`. */
  children: ReactElement | null
  /**
   * Distinct from `children`: a dangling value (id with no matching row) still counts
   * as "set" and renders content, not the placeholder.
   */
  hasValue: boolean
  /** Plain-text form of the value, folded into the accessible name alongside `label`. */
  valueText?: string
  placeholder: string
  label: string
  /** Renders a `×` beside a set value that clears without opening the overlay. */
  onClear?: () => void
  /** Renders a `↗` before the `×`, named by this label; kept in layout, hidden while `onOpen` is unset. */
  openLabel?: string
  /** Opens the value elsewhere (not the overlay). */
  onOpen?: () => void
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  testID?: string
  className?: string
}

// `renderTrigger`'s child sits under `PopoverPrimitive.Trigger asChild`, which composes its
// own ref/handlers onto top-level props (lessons-learned/aschild-slot-props.md) — hence the merge.
function mergeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === 'function') ref(node)
      else if (ref != null) (ref as { current: T | null }).current = node
    }
  }
}

/** The Input-sized trigger the in-overlay pickers share: value or placeholder, optional clear. */
export function PickerField({
  ref,
  onPress,
  open,
  children,
  hasValue,
  valueText,
  placeholder,
  label,
  onClear,
  openLabel,
  onOpen,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  testID,
  className,
  ...rest
}: PickerFieldProps) {
  const innerRef = useRef<View>(null)
  const setRef = mergeRefs<View>(innerRef, ref as Ref<View>)
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  const accessibleLabel =
    hasValue && valueText ? t('picker.fieldLabel', { label, value: valueText }) : label

  const handleClear = useCallback(() => {
    onClear?.()
    innerRef.current?.focus?.()
  }, [onClear])

  const field = (
    <View className={cn('flex-row items-center', className)}>
      <Pressable
        ref={setRef}
        onPress={onPress}
        {...rest}
        disabled={disabled}
        accessibilityRole="button"
        aria-label={accessibleLabel}
        aria-invalid={ariaInvalid}
        testID={testID}
        className={cn(
          'min-h-control-md min-w-0 flex-1 flex-row items-center gap-2 rounded-md border bg-bg-base px-3 py-1',
          invalid ? 'border-danger' : open ? 'border-accent' : 'border-border',
          disabled && 'opacity-50',
          Platform.select({
            web: cn(
              'cursor-pointer outline-none',
              invalid
                ? 'focus-visible:ring-danger/20 focus-visible:border-danger focus-visible:ring-[3px]'
                : 'focus-visible:ring-focus-ring/50 focus-visible:border-accent focus-visible:ring-[3px]',
            ),
          }),
        )}
      >
        {hasValue ? (
          children
        ) : (
          <Text size="sm" variant="muted" numberOfLines={1}>
            {placeholder}
          </Text>
        )}
      </Pressable>
      {/* Navigating isn't editing: stays live while the field is disabled. */}
      {openLabel != null ? (
        <IconAction
          icon={ExternalLink}
          label={openLabel}
          size="sm"
          disabled={onOpen == null}
          aria-hidden={onOpen == null}
          onPress={onOpen}
          className={cn('ml-1', onOpen == null && 'opacity-0')}
        />
      ) : null}
      {onClear != null ? (
        <IconAction
          icon={X}
          label={t('picker.clear')}
          size="sm"
          disabled={disabled || !hasValue}
          aria-hidden={!hasValue}
          onPress={handleClear}
          // 20px from a ↗ keeps the two 44px phone touch zones apart.
          className={cn(openLabel != null ? 'ml-5' : 'ml-1', !hasValue && 'opacity-0')}
        />
      ) : null}
    </View>
  )
  return <ReasonTooltip reason={disabled ? disabledReason : undefined}>{field}</ReasonTooltip>
}

export type { PickerFieldProps }
