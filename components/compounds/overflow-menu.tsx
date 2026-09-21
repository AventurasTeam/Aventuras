import { MoreHorizontal } from 'lucide-react-native'
import { useEffect, useRef, useState, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type OverflowMenuEntry = {
  /** Stable identifier — the React key. */
  key: string
  label: string
  disabled?: boolean
  /** Web title tooltip, native inline hint, while disabled. */
  disabledReason?: string
  destructive?: boolean
  onPress: () => void
}

type OverflowMenuProps = {
  /** The trigger's accessible name and the phone Sheet's aria label, e.g. `More actions`. */
  label: string
  entries: readonly OverflowMenuEntry[]
  disabled?: boolean
  className?: string
}

/**
 * The detail-head `⋯`. Popover on desktop and tablet, a short (content-fit)
 * bottom Sheet on phone. Entries may be disabled with a reason or marked destructive.
 */
export function OverflowMenu(props: OverflowMenuProps) {
  const isPhone = useTier() === 'phone'
  return isPhone ? <SheetMenu {...props} /> : <PopoverMenu {...props} />
}

function PopoverMenu({ label, entries, disabled, className }: OverflowMenuProps) {
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  useEffect(() => {
    if (disabled) triggerRef.current?.close()
  }, [disabled])

  return (
    <Popover ariaLabel={label}>
      <ReasonTooltip reason={label}>
        <PopoverTrigger ref={triggerRef} asChild>
          <IconAction
            icon={MoreHorizontal}
            label={label}
            size="sm"
            disabled={disabled}
            className={className}
          />
        </PopoverTrigger>
      </ReasonTooltip>
      <PopoverContent align="end" className="w-64 p-1">
        <View className="flex-col">
          {entries.map((entry) => (
            <MenuItem
              key={entry.key}
              entry={entry}
              isPhone={false}
              onSelect={() => {
                triggerRef.current?.close()
                entry.onPress()
              }}
            />
          ))}
        </View>
      </PopoverContent>
    </Popover>
  )
}

function SheetMenu({ label, entries, disabled, className }: OverflowMenuProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <Sheet open={open} onOpenChange={setOpen} ariaLabel={label}>
      <SheetTrigger asChild>
        <IconAction
          icon={MoreHorizontal}
          label={label}
          size="sm"
          disabled={disabled}
          className={className}
        />
      </SheetTrigger>
      <SheetContent size="auto">
        <View className="flex-col py-1">
          {entries.map((entry) => (
            <MenuItem
              key={entry.key}
              entry={entry}
              isPhone
              onSelect={() => {
                setOpen(false)
                entry.onPress()
              }}
            />
          ))}
        </View>
      </SheetContent>
    </Sheet>
  )
}

function MenuItem({
  entry,
  isPhone,
  onSelect,
}: {
  entry: OverflowMenuEntry
  isPhone: boolean
  onSelect: () => void
}) {
  const isDisabled = entry.disabled === true
  // WCAG 2.5.3: the accessible name must still contain the visible label.
  const accessibleLabel =
    isDisabled && entry.disabledReason ? `${entry.label}, ${entry.disabledReason}` : entry.label
  return (
    <ReasonTooltip reason={isDisabled ? entry.disabledReason : undefined}>
      <Pressable
        accessibilityRole="menuitem"
        accessibilityLabel={accessibleLabel}
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        onPress={onSelect}
        className={cn(
          'justify-center rounded-sm px-row-x-md py-row-y-md',
          isPhone ? 'min-h-control-lg' : 'min-h-control-md',
          !isDisabled &&
            cn(
              'active:bg-tint-press',
              Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }) ?? '',
            ),
          isDisabled && 'opacity-50',
        )}
      >
        <Text
          size="sm"
          className={cn(
            'font-medium',
            isDisabled && 'text-fg-muted',
            !isDisabled && entry.destructive && 'text-danger',
          )}
        >
          {entry.label}
        </Text>
        {isDisabled && entry.disabledReason && Platform.OS !== 'web' ? (
          <Text size="xs" variant="muted" className="mt-0.5">
            {entry.disabledReason}
          </Text>
        ) : null}
      </Pressable>
    </ReasonTooltip>
  )
}

export type { OverflowMenuEntry, OverflowMenuProps }
