import { X } from 'lucide-react-native'
import type { ReactNode, Ref } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import type { TriggerProps } from '@/components/ui/searchable-overlay-list'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type PickerFieldProps = {
  /** From `SearchableOverlayList`'s `renderTrigger`; spread onto the pressable so the overlay anchors. */
  trigger: TriggerProps
  /** The committed value's rendering; null shows `placeholder`. */
  children: ReactNode | null
  placeholder: string
  label: string
  /** Renders a `×` beside a set value that clears without opening the overlay. */
  onClear?: () => void
  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  testID?: string
  className?: string
}

/** The Input-sized trigger the in-overlay pickers share: value or placeholder, optional clear. */
export function PickerField({
  trigger,
  children,
  placeholder,
  label,
  onClear,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  testID,
  className,
}: PickerFieldProps) {
  const { ref, onPress, open, ...aria } = trigger
  const invalid = ariaInvalid === true || ariaInvalid === 'true'
  const field = (
    <View className={cn('flex-row items-center', className)}>
      <Pressable
        ref={ref as Ref<View>}
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        aria-label={label}
        aria-invalid={ariaInvalid}
        {...aria}
        testID={testID}
        className={cn(
          'min-h-control-md flex-1 flex-row items-center gap-2 rounded-md border bg-bg-base px-3 py-1',
          invalid ? 'border-danger' : open ? 'border-focus-ring' : 'border-border',
          disabled && 'opacity-50',
          Platform.select({
            web: 'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          }),
        )}
      >
        {children ?? (
          <Text variant="muted" numberOfLines={1}>
            {placeholder}
          </Text>
        )}
      </Pressable>
      {onClear != null && children != null ? (
        <IconAction
          icon={X}
          label={t('picker.clear')}
          size="sm"
          disabled={disabled}
          onPress={onClear}
          className="ml-1"
        />
      ) : null}
    </View>
  )
  return disabled && disabledReason ? (
    <ReasonTooltip reason={disabledReason}>{field}</ReasonTooltip>
  ) : (
    field
  )
}

export type { PickerFieldProps }
