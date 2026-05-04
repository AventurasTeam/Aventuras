import * as React from 'react'
import { Platform, TextInput, type StyleProp, type TextStyle } from 'react-native'

import { densityTokens } from '@/lib/density/registry'
import { useDensity } from '@/lib/density/use-density'
import { cn } from '@/lib/utils'

import { clamp, computeTextareaEnvelope } from './textarea-envelope'

type TextareaProps = React.ComponentProps<typeof TextInput> & {
  /**
   * Minimum visible rows. Sets the initial height. Default 3.
   */
  rows?: number
  /**
   * Maximum rows before scrolling kicks in. Default 10. Together
   * with `rows` defines the height envelope: web grows via CSS
   * `field-sizing-content`, native grows via `onContentSizeChange`
   * clamped to the same envelope.
   */
  maxRows?: number
  className?: string
  /**
   * Drives the error-state border + ring. Read JS-side and applied
   * as `border-danger` rather than via the CSS `aria-invalid:`
   * Tailwind variant — RN-Web's TextInput doesn't reliably forward
   * arbitrary aria-\* attributes to the rendered DOM.
   */
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

  const padY = parseInt(densityTokens[resolved]['--row-py-md'], 10) || 12
  const { minHeight, maxHeight } = computeTextareaEnvelope(rows, maxRows, padY)

  const [measuredHeight, setMeasuredHeight] = React.useState(minHeight)
  const handleContentSizeChange: TextareaProps['onContentSizeChange'] = (event) => {
    setMeasuredHeight(event.nativeEvent.contentSize.height)
    onContentSizeChange?.(event)
  }

  const platformStyle: StyleProp<TextStyle> =
    Platform.OS === 'web'
      ? { minHeight, maxHeight }
      : { height: clamp(measuredHeight, minHeight, maxHeight) }

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
