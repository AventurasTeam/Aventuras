import { ChevronDown } from 'lucide-react-native'
import { useRef, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

type ImporterMenuOption = {
  /** Stable identifier — used for the React key and as `accessibilityValue.text`. */
  key: string
  /** Visible label, e.g. `Blank`, `From JSON file…`, `From Vault…`. */
  label: string
  /** Optional sub-line below the label — short clarifier, never required reading. */
  description?: string
  disabled?: boolean
  /**
   * Web-only browser tooltip when the option is disabled.
   */
  disabledReason?: string
  /**
   * Caller-supplied action. Menu auto-closes after invocation.
   */
  onPress?: () => void
}

type ImporterMenuProps = {
  /** Trigger button label, e.g. `+ New character`, `+ Add calendar`. */
  label: string
  /** Action items rendered in the popover, in order. */
  options: readonly ImporterMenuOption[]
  /**
   * Trigger Button variant.
   */
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  /** External disabled state — e.g. permission / write-lock gating. */
  disabled?: boolean
  className?: string
}

export function ImporterMenu({
  label,
  options,
  variant = 'primary',
  size = 'md',
  disabled,
  className,
}: ImporterMenuProps) {
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)

  return (
    <Popover>
      <PopoverTrigger ref={triggerRef} asChild>
        <Button variant={variant} size={size} disabled={disabled} className={className}>
          <Text>{label}</Text>
          <Icon as={ChevronDown} size="sm" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1">
        <View className="flex-col">
          {options.map((opt) => (
            <ImporterMenuItem
              key={opt.key}
              option={opt}
              onSelect={() => {
                triggerRef.current?.close()
                opt.onPress?.()
              }}
            />
          ))}
        </View>
      </PopoverContent>
    </Popover>
  )
}

function ImporterMenuItem({
  option,
  onSelect,
}: {
  option: ImporterMenuOption
  onSelect: () => void
}) {
  const tier = useTier()
  const isPhone = tier === 'phone'
  const isDisabled = option.disabled === true
  const accessibleLabel = isDisabled && option.disabledReason ? option.disabledReason : option.label

  const row = (
    <Pressable
      accessibilityRole="menuitem"
      accessibilityLabel={accessibleLabel}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onSelect}
      // eslint-disable-next-line react-native/no-inline-styles -- rn-primitives wrappers don't gate disabled clicks on web; inline pointerEvents is the documented workaround.
      style={isDisabled ? { pointerEvents: 'none' } : undefined}
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
      <Text size="sm" className={cn('font-medium', isDisabled && 'text-fg-muted')}>
        {option.label}
      </Text>
      {option.description != null ? (
        <Text size="xs" variant="muted" className="mt-0.5">
          {option.description}
        </Text>
      ) : null}
    </Pressable>
  )

  if (isDisabled && option.disabledReason && Platform.OS === 'web') {
    return (
      <div title={option.disabledReason} className="flex">
        {row}
      </div>
    )
  }
  return row
}

export type { ImporterMenuOption, ImporterMenuProps }
