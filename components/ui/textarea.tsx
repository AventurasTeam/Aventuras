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
//   is applied via `min-h-*` / `max-h-*` styles. Error border + ring
//   driven from JS via `aria-invalid` prop reading (matching Input)
//   rather than the CSS `aria-invalid:` variant — RN-Web doesn't
//   reliably forward arbitrary aria-* attributes from `<TextInput>`
//   to the underlying `<textarea>`, so the attribute selector
//   silently misses.
// - ACCEPTED: `multiline`, `textAlignVertical="top"` (Android fix),
//   NativeWind 4 `placeholder:` variant on TextInput (bridged to
//   `placeholderTextColor` on RN), `field-sizing-content` + `resize-y`
//   on web (free auto-grow), `editable={false}` for disabled state.
// - SUBTRACTED: `editable={false}` alone leaves text selectable on
//   web (RN-Web maps editable false → readOnly, not disabled).
//   `select-none` on web closes that gap so the disabled state
//   reads as actually disabled.

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
  // RN 0.83's TextInput type doesn't include aria-invalid; surface
  // explicitly so consumers can drive error state through ARIA. The
  // primitive reads this prop directly to apply the danger classes
  // rather than relying on the attribute reaching the DOM (which
  // RN-Web doesn't guarantee for TextInput).
  'aria-invalid'?: boolean | 'true' | 'false'
}

export function Textarea({
  className,
  rows = 3,
  maxRows = 10,
  multiline = true,
  textAlignVertical = 'top',
  onContentSizeChange,
  onFocus,
  onBlur,
  style,
  ...props
}: TextareaProps) {
  const { resolved } = useDensity()
  const isDisabled = props.editable === false
  const ariaInvalidProp = props['aria-invalid']
  const isInvalid = ariaInvalidProp === true || ariaInvalidProp === 'true'

  const [focused, setFocused] = React.useState(false)
  const handleFocus: React.ComponentProps<typeof TextInput>['onFocus'] = (event) => {
    setFocused(true)
    onFocus?.(event)
  }
  const handleBlur: React.ComponentProps<typeof TextInput>['onBlur'] = (event) => {
    setFocused(false)
    onBlur?.(event)
  }

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

  // Border + focus-ring state classes driven from JS rather than
  // the `aria-invalid:` / `focus-visible:` CSS variants, matching
  // Input's reliability strategy.
  const focusedClass = isInvalid
    ? Platform.select({ web: 'border-danger ring-danger/20 ring-[3px]', default: 'border-danger' })
    : Platform.select({
        web: 'border-accent ring-focus-ring/50 ring-[3px]',
        default: 'border-accent',
      })

  return (
    <TextInput
      multiline={multiline}
      numberOfLines={Platform.select({ web: rows, native: maxRows })}
      textAlignVertical={textAlignVertical}
      onContentSizeChange={handleContentSizeChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className={cn(
        'w-full rounded-md border border-border bg-bg-base px-row-x-md py-row-y-md text-sm text-fg-primary',
        Platform.select({
          web: cn(
            'selection:bg-accent selection:text-accent-fg placeholder:text-fg-muted',
            'outline-none transition-[color,box-shadow]',
            // Modern web auto-grow + user vertical resize.
            'field-sizing-content resize-y',
          ),
          native: 'placeholder:text-fg-muted',
        }),
        isInvalid && 'border-danger',
        focused && focusedClass,
        isDisabled && cn('opacity-50', Platform.select({ web: 'cursor-not-allowed select-none' })),
        className,
      )}
      style={[platformStyle, style]}
      {...props}
    />
  )
}

export type { TextareaProps }
