// Aventuras Input primitive — reshaped from react-native-reusables
// baseline (which itself wraps RN's TextInput). Implements the
// contract in docs/explorations/2026-05-03-input-textarea-primitives.md
// and the canonical pattern in docs/ui/patterns/forms.md.
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (border-input/bg-background/text-foreground/
//   placeholder:text-muted-foreground/focus-visible ring tokens/
//   aria-invalid destructive ring → border-border/bg-bg-base/
//   text-fg-primary/placeholder:text-fg-muted/focus-visible
//   border-accent + focus-ring/aria-invalid border-danger +
//   ring-danger/20). Selection color reshaped from primary →
//   accent. Shadow classes stripped (Aventuras flat-depth
//   principle). Dark-mode opacity dance (dark:bg-input/30) stripped
//   — the theme registry handles light/dark per-theme. Fixed
//   height swapped to density-driven h-control-{sm|md|lg} tokens.
// - AUGMENTED (per components.md augmentation policy): `size` prop
//   resolving to density tokens; `leading` and `trailing` adornment
//   slots that re-host the border + focus ring on a wrapper View
//   when either is present, with onFocus/onBlur state driving the
//   focused border + ring on both web and native.
// - ACCEPTED: NativeWind 4's `placeholder:` variant on TextInput
//   (bridged to placeholderTextColor on RN), `editable={false}`
//   for the disabled state, plain TextInputProps pass-through.
// - SUBTRACTED: `flex-1` from the bare-path TextInput. The reusables
//   baseline assumes a flex-row parent; bare Aventuras Inputs render
//   inside arbitrary parents (often column-flex Views) where
//   `flex: 1 1 0%` competes with the explicit height token and
//   collapses padding. `w-full` is the correct fill mechanism for
//   the bare case; `flex-1` stays only on the inner TextInput in
//   the adornment path where the wrapper provides flex-row context.
// - SUBTRACTED: reliance on the `aria-invalid:` Tailwind variant
//   firing in CSS. RN-Web doesn't always forward arbitrary aria-*
//   attributes from `<TextInput>` props onto the rendered
//   `<input>`/`<textarea>`, so the attribute selector silently
//   misses. Driving the danger border + ring from JS via the
//   `aria-invalid` prop reading is reliable across platforms.

import * as React from 'react'
import { Platform, TextInput, View } from 'react-native'

import { cn } from '@/lib/utils'

type InputSize = 'sm' | 'md' | 'lg'

const SIZE_HEIGHT: Record<InputSize, string> = {
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
}

// Border + bg + radius for the field surface. Used by both the
// bare-path TextInput and the adornment-path wrapper View.
const fieldSurfaceClasses = 'rounded-md border border-border bg-bg-base'

// Web-only focus / transition tokens. Applied to whichever element
// owns the focused class — TextInput on the bare path, View on the
// adornment path (the latter via NativeWind's `focus-within:`-equivalent
// handling driven by JS state, not the CSS variant — see SUBTRACTED note
// in the file header).
const webTransitionClasses = 'transition-[color,box-shadow] outline-none'

// Text + placeholder styling for the TextInput element on either path.
const textInputClasses = cn(
  'text-sm text-fg-primary',
  Platform.select({
    web: cn('placeholder:text-fg-muted selection:bg-accent selection:text-accent-fg outline-none'),
    native: 'placeholder:text-fg-muted',
  }),
)

function focusedClasses(invalid: boolean): string {
  return Platform.select({
    web: invalid
      ? 'border-danger ring-danger/20 ring-[3px]'
      : 'border-accent ring-focus-ring/50 ring-[3px]',
    default: invalid ? 'border-danger' : 'border-accent',
  })!
}

function invalidClasses(): string {
  return 'border-danger'
}

function disabledClasses(): string {
  return cn(
    'opacity-50',
    Platform.select({
      web: 'cursor-not-allowed select-none',
    }),
  )
}

type InputProps = React.ComponentProps<typeof TextInput> & {
  size?: InputSize
  leading?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
  // RN 0.83's TextInput type doesn't include aria-invalid; surface
  // explicitly so consumers can drive error state through ARIA. The
  // primitive reads this prop directly to apply the danger classes
  // rather than relying on the attribute reaching the DOM (which
  // RN-Web doesn't guarantee for TextInput).
  'aria-invalid'?: boolean | 'true' | 'false'
}

export function Input({
  className,
  size = 'md',
  leading,
  trailing,
  editable,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const hasAdornment = leading != null || trailing != null
  const isDisabled = editable === false
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

  const stateClasses = cn(
    isInvalid && invalidClasses(),
    focused && focusedClasses(isInvalid),
    isDisabled && disabledClasses(),
  )

  if (!hasAdornment) {
    // Bare path — TextInput owns its own surface, height, padding.
    // No flex-1 here: bare Inputs render inside arbitrary parents
    // (often column-flex Views) where flex-1 collapses padding.
    return (
      <TextInput
        editable={editable}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          fieldSurfaceClasses,
          SIZE_HEIGHT[size],
          'w-full px-3',
          textInputClasses,
          Platform.select({ web: webTransitionClasses }),
          stateClasses,
          className,
        )}
        {...props}
      />
    )
  }

  // Adornment path — wrapper View hosts the border + focus ring;
  // inner TextInput fills the remaining row width via flex-1.
  return (
    <View
      className={cn(
        fieldSurfaceClasses,
        'flex-row items-center',
        SIZE_HEIGHT[size],
        Platform.select({ web: webTransitionClasses }),
        stateClasses,
        className,
      )}
    >
      {leading != null ? <View className="pl-3 pr-2">{leading}</View> : null}
      <TextInput
        editable={editable}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          textInputClasses,
          'h-full flex-1',
          leading == null && 'pl-3',
          trailing == null && 'pr-3',
        )}
        {...props}
      />
      {trailing != null ? <View className="pl-2 pr-2">{trailing}</View> : null}
    </View>
  )
}

export type { InputProps }
