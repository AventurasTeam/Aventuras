import { Pencil } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, type TextInputKeyPressEvent, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type InlineEditableNameSize = 'sm' | 'md' | 'lg'

type InlineEditableNameProps = {
  value: string
  onChange: (next: string) => void
  /**
   * The committed value. A change mid-edit is a save landing, and Escape then restores it
   * instead of the value the edit started from.
   */
  savedValue?: string
  placeholder?: string
  disabled?: boolean
  /**
   * Text size variant — applies to both the read label and the
   * edit input. Default `'md'`. The detail head consumer will use
   * `'lg'` for entity names; smaller surfaces can use `'sm'`/`'md'`.
   */
  size?: InlineEditableNameSize
  /** Optional className applied to the outer container. */
  className?: string
}

const TEXT_SIZE: Record<InlineEditableNameSize, 'sm' | 'base' | 'lg'> = {
  sm: 'sm',
  md: 'base',
  lg: 'lg',
}

const ICON_SIZE: Record<InlineEditableNameSize, 'sm' | 'md' | 'lg'> = {
  sm: 'sm',
  md: 'sm',
  lg: 'md',
}

const GAP: Record<InlineEditableNameSize, string> = {
  sm: 'gap-1',
  md: 'gap-2',
  lg: 'gap-2',
}

export function InlineEditableName({
  value,
  onChange,
  savedValue,
  placeholder,
  disabled = false,
  size = 'md',
  className,
}: InlineEditableNameProps) {
  const [editing, setEditing] = useState(false)
  // Every keystroke reaches `onChange`, so a save session sees the edit before blur;
  // Escape puts back the value the edit started from, or the last save made during it.
  const startRef = useRef(value)

  useEffect(() => {
    if (savedValue !== undefined) startRef.current = savedValue
  }, [savedValue])

  useEffect(() => {
    if (disabled && editing) setEditing(false)
  }, [disabled, editing])

  const enterEdit = useCallback(() => {
    if (disabled) return
    startRef.current = value
    setEditing(true)
  }, [disabled, value])

  const exitEdit = useCallback(() => setEditing(false), [])

  const cancel = useCallback(() => {
    if (value !== startRef.current) onChange(startRef.current)
    setEditing(false)
  }, [onChange, value])

  const handleKeyPress = (e: TextInputKeyPressEvent) => {
    if (Platform.OS !== 'web') return
    const key = e.nativeEvent.key
    if (key === 'Escape') {
      e.preventDefault?.()
      cancel()
    }
  }

  if (disabled) {
    return (
      <View className={cn('flex-row items-center', GAP[size], className)}>
        {value === '' ? (
          <Text variant="muted" size={TEXT_SIZE[size]}>
            {placeholder ?? ''}
          </Text>
        ) : (
          <Text variant="disabled" size={TEXT_SIZE[size]}>
            {value}
          </Text>
        )}
      </View>
    )
  }

  if (editing) {
    return (
      <View className={cn('flex-row items-center', GAP[size], className)}>
        <Input
          size={size}
          value={value}
          onChangeText={onChange}
          onBlur={exitEdit}
          onSubmitEditing={exitEdit}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          autoFocus
          selectTextOnFocus
          returnKeyType="done"
          className="flex-1"
        />
      </View>
    )
  }

  return (
    <Pressable
      onPress={enterEdit}
      accessibilityRole="button"
      accessibilityLabel={
        value === ''
          ? (placeholder ?? t('inlineEditableName.editUnnamed'))
          : t('inlineEditableName.edit', { name: value })
      }
      className={cn(
        'group flex-row items-center rounded-sm',
        GAP[size],
        Platform.select({ web: 'hover:bg-tint-hover' }),
        className,
      )}
    >
      {value === '' ? (
        <Text variant="muted" size={TEXT_SIZE[size]}>
          {placeholder ?? ''}
        </Text>
      ) : (
        <Text size={TEXT_SIZE[size]}>{value}</Text>
      )}
      {/* Decorative glyph: the whole row is the button, so the pencil must not be a
          nested interactive element (a <button> in a <button> is invalid DOM). */}
      <Icon
        as={Pencil}
        size={ICON_SIZE[size]}
        className={cn('text-fg-secondary', Platform.select({ web: 'group-hover:text-fg-primary' }))}
      />
    </Pressable>
  )
}

export type { InlineEditableNameProps, InlineEditableNameSize }
