// Aventuras Textarea primitive — reshaped from react-native-reusables
// baseline. Implements the contract in
// docs/explorations/2026-05-03-input-textarea-primitives.md and the
// canonical pattern in docs/ui/patterns/forms.md.
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: same color-token swap as Input (border-input/
//   bg-transparent/text-foreground/placeholder/focus-visible/
//   aria-invalid → Aventuras slots). Shadow stripped. Fixed
//   min-height swapped to a `rows`-driven calc. Fixed padding swapped
//   to density tokens (py-row-y-md / px-row-x-md).
// - AUGMENTED (per components.md augmentation policy): `rows` and
//   `maxRows` props driving an explicit min/max height envelope.
//   On native, `onContentSizeChange` updates measured height which
//   is clamped to that envelope. On web, `field-sizing-content`
//   from the baseline handles auto-grow natively; the same envelope
//   is applied via `min-h-*` / `max-h-*` styles.
// - ACCEPTED: `multiline`, `textAlignVertical="top"` (Android fix),
//   NativeWind 4 `placeholder:` and `aria-` variants on TextInput,
//   `field-sizing-content` + `resize-y` on web (free auto-grow),
//   `editable={false}` for disabled state.

import * as React from 'react'
import { Platform, TextInput, type StyleProp, type TextStyle } from 'react-native'

import { densityTokens } from '@/lib/density/registry'
import { useDensity } from '@/lib/density/use-density'
import { cn } from '@/lib/utils'

import { clamp, computeTextareaEnvelope } from './textarea-envelope'

type TextareaProps = React.ComponentProps<typeof TextInput> & {
  rows?: number
  maxRows?: number
  className?: string
}

export function Textarea({
  className,
  rows = 3,
  maxRows = 10,
  multiline = true,
  textAlignVertical = 'top',
  onContentSizeChange,
  style,
  ...props
}: TextareaProps) {
  const { resolved } = useDensity()
  const isDisabled = props.editable === false
  // The density token is e.g. '12px' — parse to pixel count for
  // the height envelope math. Density values are static strings;
  // parseInt is safe and cheap.
  const padY = parseInt(densityTokens[resolved]['--row-py-md'], 10) || 12
  const { minHeight, maxHeight } = computeTextareaEnvelope(rows, maxRows, padY)

  // Native auto-grow: measured content height clamped to the
  // envelope. Initial value is the min so the first paint matches
  // the post-mount steady state.
  const [measuredHeight, setMeasuredHeight] = React.useState(minHeight)
  const handleContentSizeChange: TextareaProps['onContentSizeChange'] = (event) => {
    setMeasuredHeight(event.nativeEvent.contentSize.height)
    onContentSizeChange?.(event)
  }

  // Web reads min/max envelope statically (CSS handles auto-grow
  // via field-sizing-content). Native applies measured height
  // clamped to the same envelope.
  const platformStyle: StyleProp<TextStyle> =
    Platform.OS === 'web'
      ? { minHeight, maxHeight }
      : { height: clamp(measuredHeight, minHeight, maxHeight) }

  return (
    <TextInput
      multiline={multiline}
      numberOfLines={Platform.select({ web: rows, native: maxRows })}
      textAlignVertical={textAlignVertical}
      onContentSizeChange={handleContentSizeChange}
      className={cn(
        'w-full rounded-md border border-border bg-bg-base px-row-x-md py-row-y-md text-sm text-fg-primary',
        Platform.select({
          web: cn(
            'selection:bg-accent selection:text-accent-fg placeholder:text-fg-muted',
            'outline-none transition-[color,box-shadow]',
            'focus-visible:ring-focus-ring/50 focus-visible:border-accent focus-visible:ring-[3px]',
            'aria-invalid:border-danger aria-invalid:ring-danger/20',
            // Modern web auto-grow + user vertical resize.
            'field-sizing-content resize-y',
            isDisabled && 'disabled:cursor-not-allowed',
          ),
          native: 'placeholder:text-fg-muted',
        }),
        isDisabled && 'opacity-50',
        className,
      )}
      style={[platformStyle, style]}
      {...props}
    />
  )
}

export type { TextareaProps }
