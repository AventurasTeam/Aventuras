import { Pencil } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, type TextInputKeyPressEvent, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type InlineEditableNameSize = 'sm' | 'md' | 'lg'

type InlineEditableNameProps = {
  value: string
  onChange: (next: string) => void
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

const ICON_ACTION_SIZE: Record<InlineEditableNameSize, 'sm' | 'md' | 'lg'> = {
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
  placeholder,
  disabled = false,
  size = 'md',
  className,
}: InlineEditableNameProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const exitedRef = useRef(false)

  useEffect(() => {
    if (disabled && editing) {
      exitedRef.current = true
      setEditing(false)
      setDraft(value)
    }
  }, [disabled, editing, value])

  // If the consumer reassigns `value` while not editing, keep the
  // buffered draft aligned so the next edit starts from current truth.
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const enterEdit = useCallback(() => {
    if (disabled) return
    exitedRef.current = false
    setDraft(value)
    setEditing(true)
  }, [disabled, value])

  const commit = useCallback(
    (next: string) => {
      // Skip if Escape or a previous Enter / blur already handled the
      // exit — guards against the unmount-blur double-fire.
      if (exitedRef.current) {
        exitedRef.current = false
        return
      }
      exitedRef.current = true
      setEditing(false)
      if (next !== value) onChange(next)
    },
    [onChange, value],
  )

  const cancel = useCallback(() => {
    exitedRef.current = true
    setDraft(value)
    setEditing(false)
  }, [value])

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
          value={draft}
          onChangeText={setDraft}
          onBlur={() => commit(draft)}
          onSubmitEditing={() => commit(draft)}
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
      accessibilityLabel={value === '' ? (placeholder ?? 'Edit name') : `Edit ${value}`}
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
      <IconAction
        icon={Pencil}
        label="Edit name"
        size={ICON_ACTION_SIZE[size]}
        onPress={enterEdit}
      />
    </Pressable>
  )
}

export type { InlineEditableNameProps, InlineEditableNameSize }
