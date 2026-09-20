import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'

type NumberInputProps = {
  /** `null` while the field is empty or holds text that is not a plain decimal number. */
  value: number | null
  onChange: (next: number | null) => void
  /** Accessible name; pair with a visible `FormRow` label. */
  label: string
  /** Reject fractions. Default true. */
  integer?: boolean
  placeholder?: string
  disabled?: boolean
  /** Surfaced only while `disabled`. */
  disabledReason?: string
  /** Out of range per the owner's validation; drives the error border. */
  invalid?: boolean
  testID?: string
  className?: string
}

// `Number()` alone also accepts hex (`0x10`), exponents (`1e3`) and `Infinity`.
const INTEGER_TEXT = /^-?\d+$/
const DECIMAL_TEXT = /^-?(?:\d+\.?\d*|\.\d+)$/
// Keyboards in comma-decimal locales type the separator as `,` (`0,5`).
const COMMA_DECIMAL = /^(-?\d*),(\d*)$/

function parseNumberText(text: string, integer: boolean): number | null {
  const trimmed = text.trim()
  const candidate = integer ? trimmed : trimmed.replace(COMMA_DECIMAL, '$1.$2')
  if (!(integer ? INTEGER_TEXT : DECIMAL_TEXT).test(candidate)) return null
  const parsed = Number(candidate)
  return Number.isFinite(parsed) ? parsed : null
}

function formatNumber(value: number | null): string {
  return value == null ? '' : String(value)
}

/**
 * A numeric text field that reports `null` for empty or unparseable text so the
 * owner can refuse the save, rather than clamping silently. The text is local
 * state: a prop change that disagrees with what is typed (Discard, a post-save
 * reset) replaces it, an in-flight edit that still parses to the prop does not.
 */
export function NumberInput({
  value,
  onChange,
  label,
  integer = true,
  placeholder,
  disabled = false,
  disabledReason,
  invalid = false,
  testID,
  className,
}: NumberInputProps) {
  const [text, setText] = useState(() => formatNumber(value))
  // Synced during render, not in an effect: an effect would need an exhaustive-deps
  // suppression, which makes React Compiler skip the component.
  const [syncedValue, setSyncedValue] = useState(value)
  if (!Object.is(value, syncedValue)) {
    setSyncedValue(value)
    if (parseNumberText(text, integer) !== value) setText(formatNumber(value))
  }

  const unreadable = text.trim() !== '' && parseNumberText(text, integer) == null

  return (
    <ReasonTooltip reason={disabled ? disabledReason : undefined}>
      <Input
        testID={testID}
        aria-label={label}
        accessibilityHint={disabled ? disabledReason : undefined}
        value={text}
        onChangeText={(next) => {
          setText(next)
          onChange(parseNumberText(next, integer))
        }}
        placeholder={placeholder}
        editable={!disabled}
        inputMode={integer ? 'numeric' : 'decimal'}
        aria-invalid={invalid || unreadable}
        className={className}
      />
    </ReasonTooltip>
  )
}

export type { NumberInputProps }
