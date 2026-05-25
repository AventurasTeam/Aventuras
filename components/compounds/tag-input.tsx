import { useCallback, useRef, useState } from 'react'
import { Platform, TextInput, View, type TextInputKeyPressEvent } from 'react-native'

import { Tag } from '@/components/ui/tag'
import { cn } from '@/lib/utils'

type TagInputProps = {
  /** Controlled value — committed tags. */
  value: readonly string[]
  /** Fires on add (Enter / comma / blur / paste-split) and on remove (chip × / Backspace-on-empty). */
  onChange: (next: string[]) => void

  placeholder?: string
  disabled?: boolean
  /**
   * When set with `disabled`, surfaces as the browser-native `title`
   * tooltip on web. RN-Web's `View` filters unknown HTML attrs, so
   * a `title` prop on the wrapper doesn't reach the DOM — same
   * raw-`<div>` workaround Input and Autocomplete use.
   */
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'

  className?: string
  inputClassName?: string

  /** Total tags ceiling. When reached, the input visually disables; chip × still works. */
  maxCount?: number
  /** Per-tag character cap. Applied to typing (`maxLength`) and to paste-split pieces (truncate). */
  maxTagLength?: number
}

function dedupesAgainst(existing: readonly string[], candidate: string): boolean {
  const lc = candidate.toLowerCase()
  return existing.some((t) => t.toLowerCase() === lc)
}

function commitOne(
  existing: readonly string[],
  candidate: string,
  maxCount: number | undefined,
  maxTagLength: number | undefined,
): readonly string[] {
  const trimmed = candidate.trim()
  if (!trimmed) return existing
  const capped = maxTagLength != null ? trimmed.slice(0, maxTagLength) : trimmed
  if (dedupesAgainst(existing, capped)) return existing
  if (maxCount != null && existing.length >= maxCount) return existing
  return [...existing, capped]
}

function commitMany(
  existing: readonly string[],
  candidates: readonly string[],
  maxCount: number | undefined,
  maxTagLength: number | undefined,
): readonly string[] {
  let next = existing
  for (const c of candidates) {
    next = commitOne(next, c, maxCount, maxTagLength)
  }
  return next
}

function splitIncoming(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  className,
  inputClassName,
  maxCount,
  maxTagLength,
}: TagInputProps) {
  const [typed, setTyped] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<TextInput>(null)

  const isInvalid = ariaInvalid === true || ariaInvalid === 'true'
  const atCap = maxCount != null && value.length >= maxCount
  const inputEditable = !disabled && !atCap

  // Commit the currently-typed value if non-empty + non-dupe.
  // Always clears `typed` afterward — even on dedupe-rejection.
  const commitTyped = useCallback(() => {
    const trimmed = typed.trim()
    if (!trimmed) {
      if (typed !== '') setTyped('')
      return
    }
    const next = commitOne(value, trimmed, maxCount, maxTagLength)
    if (next !== value) onChange(next as string[])
    setTyped('')
  }, [typed, value, onChange, maxCount, maxTagLength])

  // onChangeText handles separator-bearing input (comma / newline /
  // pasted multi-tag content). Trailing fragment after the last
  // separator stays as the new typed value — covers both the
  // "type sci-fi, fa" mid-typing case and the "paste sci-fi,
  // fantasy" case (user can press Enter/comma to commit the
  // trailing fragment).
  const handleChangeText = useCallback(
    (raw: string) => {
      const hasSep = raw.includes(',') || raw.includes('\n')
      if (hasSep) {
        const lastSepIdx = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('\n'))
        const head = raw.slice(0, lastSepIdx)
        const tail = raw.slice(lastSepIdx + 1)
        const pieces = splitIncoming(head)
        if (pieces.length > 0) {
          const next = commitMany(value, pieces, maxCount, maxTagLength)
          if (next !== value) onChange(next as string[])
        }
        setTyped(maxTagLength != null ? tail.slice(0, maxTagLength) : tail)
        return
      }
      setTyped(maxTagLength != null ? raw.slice(0, maxTagLength) : raw)
    },
    [value, onChange, maxCount, maxTagLength],
  )

  // Backspace-on-empty removes the last chip. Web fires onKeyPress
  // for Backspace reliably; native iOS has a known RN gotcha where
  // onKeyPress doesn't fire for Backspace on an already-empty
  // input — accepted as best-effort per the pattern doc.
  const handleKeyPress = useCallback(
    (e: TextInputKeyPressEvent) => {
      const key = e.nativeEvent.key
      if (key === 'Backspace' && typed === '' && value.length > 0) {
        e.preventDefault?.()
        onChange(value.slice(0, -1))
      }
    },
    [typed, value, onChange],
  )

  const handleSubmitEditing = useCallback(() => {
    commitTyped()
  }, [commitTyped])

  const handleBlur = useCallback(() => {
    setFocused(false)
    commitTyped()
  }, [commitTyped])

  const handleFocus = useCallback(() => {
    setFocused(true)
  }, [])

  const removeAt = useCallback(
    (idx: number) => {
      onChange(value.filter((_, i) => i !== idx))
    },
    [value, onChange],
  )

  const wrapperClasses = cn(
    'flex-row flex-wrap items-center gap-1.5 rounded-md border border-border bg-bg-base px-2',
    focused
      ? Platform.select({
          web: isInvalid
            ? 'border-danger ring-danger/20 ring-[3px]'
            : 'border-accent ring-focus-ring/50 ring-[3px]',
          default: isInvalid ? 'border-danger' : 'border-accent',
        })
      : isInvalid && 'border-danger',
    disabled && cn('opacity-50', Platform.select({ web: 'cursor-not-allowed select-none' })),
    Platform.select({ web: 'transition-[color,box-shadow] outline-none' }),
    className,
  )

  const inputClasses = cn(
    'min-h-control-md min-w-[60px] flex-1 text-sm text-fg-primary',
    Platform.select({
      web: 'placeholder:text-fg-muted selection:bg-accent selection:text-accent-fg outline-none',
      native: 'placeholder:text-fg-muted',
    }),
    inputClassName,
  )

  const wrapper = (
    <View className={wrapperClasses}>
      {value.map((tag, idx) => (
        <Tag key={tag} removable onRemove={() => removeAt(idx)} disabled={disabled}>
          {tag}
        </Tag>
      ))}
      <TextInput
        ref={inputRef}
        value={typed}
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        onSubmitEditing={handleSubmitEditing}
        onFocus={handleFocus}
        onBlur={handleBlur}
        editable={inputEditable}
        placeholder={value.length === 0 ? placeholder : undefined}
        // Keep keyboard up after Enter so iterative entry works
        // without a re-tap. Standard tokenized-input behavior.
        submitBehavior="submit"
        returnKeyType="default"
        maxLength={maxTagLength}
        className={inputClasses}
      />
    </View>
  )

  if (disabled && disabledReason && Platform.OS === 'web') {
    return <div title={disabledReason}>{wrapper}</div>
  }
  return wrapper
}

export type { TagInputProps }
