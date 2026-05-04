import * as React from 'react'
import { Platform, TextInput, View } from 'react-native'

import { cn } from '@/lib/utils'

type InputSize = 'sm' | 'md' | 'lg'

const SIZE_HEIGHT: Record<InputSize, string> = {
  sm: 'h-control-sm',
  md: 'h-control-md',
  lg: 'h-control-lg',
}

const fieldSurfaceClasses = 'rounded-md border border-border bg-bg-base'

const webTransitionClasses = 'transition-[color,box-shadow] outline-none'

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
  /**
   * Slot before the text input — typically a leading Icon (search
   * glyph, etc.). Renders inside the input frame, padded against
   * the input edge. Pass `<Icon as={Search} size="sm" />` shaped.
   */
  leading?: React.ReactNode
  /**
   * Slot after the text input — typically a trailing affordance
   * (password show/hide toggle, clear button, info popover trigger).
   * Treat as interactive: wrap in `<Pressable>` if it should respond
   * to taps without focusing the input.
   */
  trailing?: React.ReactNode
  className?: string
  /**
   * Drives the error-state border + ring. Read JS-side and applied
   * as `border-danger` rather than via the CSS `aria-invalid:`
   * Tailwind variant — RN-Web's TextInput doesn't reliably forward
   * arbitrary aria-\* attributes to the rendered DOM.
   */
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
