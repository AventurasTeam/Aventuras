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
