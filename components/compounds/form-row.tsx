import { useState, type ReactNode } from 'react'
import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type FormRowProps = {
  /** Field label. Always rendered; shape depends on layout mode. */
  label: string
  /**
   * Inline help text. Sits above the control when stacked, below it in the
   * two-column layout. Suppressed while `error` is set.
   */
  hint?: string
  /** Validation error string. Always renders below the control. */
  error?: string
  /** Renders a `*` indicator next to the label. Visual only. */
  required?: boolean
  className?: string
  /**
   * Override the auto layout.
   */
  stacked?: boolean
  /** The control (Input, Select, Autocomplete, Textarea, …). */
  children: ReactNode
}

const NARROW_THRESHOLD_PX = 640
const WIDE_LABEL_COLUMN_PX = 180
const NARROW_LABEL_COLUMN_PX = 120

export function FormRow({
  label,
  hint,
  error,
  required,
  className,
  stacked: stackedOverride,
  children,
}: FormRowProps) {
  const initialTier = useTier()
  const [containerWidth, setContainerWidth] = useState<number | null>(null)

  const stacked =
    stackedOverride ??
    (containerWidth != null ? containerWidth < NARROW_THRESHOLD_PX : initialTier !== 'desktop')

  const labelColumnPx =
    containerWidth != null && containerWidth >= 1024 ? WIDE_LABEL_COLUMN_PX : NARROW_LABEL_COLUMN_PX

  const requiredMark = required ? <Text className="text-danger"> *</Text> : null

  return (
    <View
      className={cn('w-full', className)}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {stacked ? (
        <View className="gap-1.5">
          <Text className="text-sm font-medium text-fg-primary">
            {label}
            {requiredMark}
          </Text>
          {/* Hint above, error below — forms.md → Stacked-row visual treatment. */}
          {error == null && hint != null ? (
            <Text className="text-xs text-fg-secondary">{hint}</Text>
          ) : null}
          {children}
          {error != null ? <Text className="text-xs text-danger">{error}</Text> : null}
        </View>
      ) : (
        <View className="flex-row items-start gap-3">
          <View style={{ width: labelColumnPx }} className="pt-2">
            <Text className="font-mono text-[11px] uppercase tracking-wider text-fg-secondary">
              {label}
              {requiredMark}
            </Text>
          </View>
          <View className="flex-1 gap-1">
            {children}
            {error != null ? (
              <Text className="text-xs text-danger">{error}</Text>
            ) : hint != null ? (
              <Text className="text-xs text-fg-secondary">{hint}</Text>
            ) : null}
          </View>
        </View>
      )}
    </View>
  )
}

export type { FormRowProps }
