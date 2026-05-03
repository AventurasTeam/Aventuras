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
//   when either is present, with focus-within (web) and onFocus/
//   onBlur state (native) driving the focused border + ring.
// - ACCEPTED: NativeWind 4's `placeholder:` and `aria-` variants
//   on TextInput (bridged to placeholderTextColor / aria-invalid
//   on RN), `field-sizing-content` on web (free auto-grow),
//   `editable={false}` for the disabled state, plain TextInputProps
//   pass-through.

import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { Platform, TextInput, View } from 'react-native'

import { cn } from '@/lib/utils'

const inputBoxVariants = cva(
  cn(
    'flex-row items-center rounded-md border border-border bg-bg-base',
    Platform.select({
      web: cn(
        'transition-[color,box-shadow] outline-none',
        'focus-visible:border-accent focus-visible:ring-focus-ring/50 focus-visible:ring-[3px]',
        'aria-invalid:border-danger aria-invalid:ring-danger/20',
      ),
    }),
  ),
  {
    variants: {
      size: {
        sm: 'h-control-sm',
        md: 'h-control-md',
        lg: 'h-control-lg',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

// Wrapper variant — only used when adornments are present. The
// border + ring move from the TextInput to the wrapper; classes
// without `aria-invalid:` on the wrapper trigger via
// `[aria-invalid=true]` propagating through the inner TextInput's
// aria-invalid prop, but since the attribute lives on the inner
// element we use `:has(input[aria-invalid='true'])` on web and an
// explicit `ariaInvalid` discriminator on native.
const wrapperVariants = cva('flex-row items-center rounded-md border border-border bg-bg-base', {
  variants: {
    size: {
      sm: 'h-control-sm',
      md: 'h-control-md',
      lg: 'h-control-lg',
    },
    focused: { true: '', false: '' },
    invalid: { true: '', false: '' },
  },
  compoundVariants: [
    // Focused, not invalid — accent border + focus ring.
    {
      focused: true,
      invalid: false,
      className: Platform.select({
        web: 'border-accent ring-focus-ring/50 ring-[3px]',
        default: 'border-accent',
      }),
    },
    // Invalid (regardless of focus) — danger border, danger ring
    // when focused.
    {
      invalid: true,
      focused: false,
      className: 'border-danger',
    },
    {
      invalid: true,
      focused: true,
      className: Platform.select({
        web: 'border-danger ring-danger/20 ring-[3px]',
        default: 'border-danger',
      }),
    },
  ],
  defaultVariants: { size: 'md', focused: false, invalid: false },
})

type InputBoxProps = VariantProps<typeof inputBoxVariants>

type InputProps = React.ComponentProps<typeof TextInput> &
  InputBoxProps & {
    leading?: React.ReactNode
    trailing?: React.ReactNode
    className?: string
    // RN 0.83's TextInput type doesn't include aria-invalid, but
    // RN-Web forwards it as the HTML attribute and NativeWind 4
    // honors it as a class variant on native. Surface explicitly so
    // consumers can drive error state through ARIA.
    'aria-invalid'?: boolean | 'true' | 'false'
  }

const baseTextInputClasses = cn(
  'flex-1 text-sm text-fg-primary',
  Platform.select({
    web: cn(
      'placeholder:text-fg-muted selection:bg-accent selection:text-accent-fg',
      'min-w-0 outline-none',
    ),
    native: 'placeholder:text-fg-muted',
  }),
)

export function Input({
  className,
  size,
  leading,
  trailing,
  editable,
  onFocus,
  onBlur,
  ...props
}: InputProps) {
  const hasAdornment = leading != null || trailing != null
  const isDisabled = editable === false
  const ariaInvalid = props['aria-invalid'] === true || props['aria-invalid'] === 'true'

  const [focused, setFocused] = React.useState(false)
  const handleFocus: React.ComponentProps<typeof TextInput>['onFocus'] = (event) => {
    setFocused(true)
    onFocus?.(event)
  }
  const handleBlur: React.ComponentProps<typeof TextInput>['onBlur'] = (event) => {
    setFocused(false)
    onBlur?.(event)
  }

  if (!hasAdornment) {
    // Bare path — TextInput owns its own border + ring + height.
    // Single-node tree for the common case.
    return (
      <TextInput
        editable={editable}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          inputBoxVariants({ size }),
          baseTextInputClasses,
          'px-3',
          isDisabled && 'opacity-50',
          Platform.select({ web: isDisabled && 'disabled:cursor-not-allowed' }),
          className,
        )}
        {...props}
      />
    )
  }

  // Adornment path — wrapper View hosts the border + focus ring.
  return (
    <View
      className={cn(
        wrapperVariants({ size, focused, invalid: ariaInvalid }),
        isDisabled && 'opacity-50',
        className,
      )}
    >
      {leading != null ? <View className="pl-3 pr-2">{leading}</View> : null}
      <TextInput
        editable={editable}
        onFocus={handleFocus}
        onBlur={handleBlur}
        className={cn(
          baseTextInputClasses,
          'h-full',
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
