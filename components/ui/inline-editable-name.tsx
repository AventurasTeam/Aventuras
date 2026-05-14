import { Pencil } from 'lucide-react-native'
import * as React from 'react'
import { Platform, Pressable, type TextInputKeyPressEvent, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

/**
 * InlineEditableName — single-line text affordance that swaps to an
 * `Input` on user request and writes back on commit.
 *
 * Read state shows the value as `<Text>` paired with a Pencil
 * `IconAction` on the right. Per the icon-action convention the
 * pencil sits at `text-fg-secondary` and brightens to
 * `text-fg-primary` on row (`group`) hover/focus on web — so a touch
 * surface always sees the pencil receded-but-visible and a desktop
 * surface gets the hover-reveal cue. Tap on the row body or the
 * pencil enters edit state.
 *
 * Edit state mounts an `<Input>` sized to match the read label, with
 * its in-progress value buffered locally. **Blur** and **Enter**
 * commit the buffer to `onChange` (only if it changed from `value`).
 * **Escape** on web cancels and reverts.
 *
 * Sizing maps onto sibling primitive sizes:
 *  - `sm` → `<Text size="sm">` + `<Input size="sm">`
 *  - `md` → `<Text size="base">` + `<Input size="md">`
 *  - `lg` → `<Text size="lg">` + `<Input size="lg">`
 *
 * Truncation is intentionally a consumer concern — DetailPane's head
 * handles overflow at the row level. The component renders names in
 * full.
 */

type InlineEditableNameSize = 'sm' | 'md' | 'lg'

type InlineEditableNameProps = {
  value: string
  onChange: (next: string) => void
  /** Shown in read state when `value === ''` and as the Input placeholder while editing. */
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
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  // Escape, Enter, and disabled-mid-edit each exit edit mode by
  // unmounting the Input, which fires a synthetic blur on the way
  // out. Without a guard, blur would fire a redundant `onChange`
  // (Enter case — already committed) or commit an Escape-discarded
  // buffer. The ref short-circuits the post-exit blur. Refs avoid
  // an extra render pass.
  const exitedRef = React.useRef(false)

  // When the consumer toggles `disabled` mid-edit, drop edit state to
  // keep the affordance consistent with the spec ("when disabled, row
  // not tappable"). Treat as a cancel — the in-progress draft is
  // discarded, not committed, because the consumer's disable signal
  // overrides the user's edit intent.
  React.useEffect(() => {
    if (disabled && editing) {
      exitedRef.current = true
      setEditing(false)
      setDraft(value)
    }
  }, [disabled, editing, value])

  // If the consumer reassigns `value` while not editing, keep the
  // buffered draft aligned so the next edit starts from current truth.
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const enterEdit = React.useCallback(() => {
    if (disabled) return
    exitedRef.current = false
    setDraft(value)
    setEditing(true)
  }, [disabled, value])

  const commit = React.useCallback(
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

  const cancel = React.useCallback(() => {
    exitedRef.current = true
    setDraft(value)
    setEditing(false)
  }, [value])

  // Focus + select-all on entering edit state is handled by the
  // freshly-mounted `<Input>` via `autoFocus` + `selectTextOnFocus`.
  // The Input primitive doesn't expose a ref, so we lean on the
  // mount lifecycle rather than imperative focus.

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

  // Read state: row is a Pressable `group` so the IconAction's
  // group-hover modifier brightens the pencil whenever the row is
  // hovered (web). Native gets no hover; pencil stays at
  // text-fg-secondary (visible per spec).
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
