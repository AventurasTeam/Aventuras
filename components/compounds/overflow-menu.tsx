import { MoreHorizontal } from 'lucide-react-native'
import { useRef, useState, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type OverflowMenuEntry = {
  /** Stable identifier — React key and `accessibilityValue.text`. */
  key: string
  label: string
  disabled?: boolean
  /** Web title tooltip, native inline hint, while disabled. */
  disabledReason?: string
  destructive?: boolean
  onPress: () => void
}

type OverflowMenuProps = {
  /** The trigger's accessible name and the phone Sheet title, e.g. `More actions`. */
  label: string
  entries: readonly OverflowMenuEntry[]
  disabled?: boolean
  className?: string
}

/**
 * The detail-head `⋯`: Popover on desktop and tablet, Sheet (short) on phone.
 * An entry's disabled-with-reason state is how a not-yet-built action (export,
 * delete) renders until that capability lands.
 */
export function OverflowMenu(props: OverflowMenuProps) {
  const isPhone = useTier() === 'phone'
  return isPhone ? <SheetMenu {...props} /> : <PopoverMenu {...props} />
}

function PopoverMenu({ label, entries, disabled, className }: OverflowMenuProps) {
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)
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
      <SheetContent size="short" title={label}>
        <View className="flex-col py-1">
          {entries.map((entry) => (
            <MenuItem
              key={entry.key}
              entry={entry}
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

function MenuItem({ entry, onSelect }: { entry: OverflowMenuEntry; onSelect: () => void }) {
  const isPhone = useTier() === 'phone'
  const isDisabled = entry.disabled === true
  // Same convention as ImporterMenu: a disabled entry's accessible name is its reason.
  const accessibleLabel = isDisabled && entry.disabledReason ? entry.disabledReason : entry.label
  const row = (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ disabled: isDisabled }}
      accessibilityValue={{ text: entry.key }}
      disabled={isDisabled}
      onPress={onSelect}
      // rn-primitives wrappers don't gate disabled clicks on web.
      style={isDisabled ? POINTER_EVENTS_NONE : undefined}
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
  )
  if (isDisabled && entry.disabledReason && Platform.OS === 'web') {
    return (
      <div title={entry.disabledReason} className="flex">
        {row}
      </div>
    )
  }
  return row
}

export type { OverflowMenuEntry, OverflowMenuProps }
