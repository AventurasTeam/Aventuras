import { ChevronDown, Plus } from 'lucide-react-native'
import { useEffect, useLayoutEffect, useRef, type ComponentRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { IconAction } from '@/components/ui/icon-action'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
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
  /** Trigger label, e.g. `+ New character`; with `trigger="icon"` it is the accessible name. */
  label: string
  /** Action items rendered in the popover, in order. */
  options: readonly ImporterMenuOption[]
  /** Trigger Button variant — applies only to the `button` trigger. */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Trigger size — both the `button` and `icon` triggers. */
  size?: 'sm' | 'md' | 'lg'
  /** External disabled state — e.g. permission / write-lock gating. Closes an open menu. */
  disabled?: boolean
  className?: string
  /** `button` (default) renders `label ▾`; `icon` renders a bare `[+]` IconAction. */
  trigger?: 'button' | 'icon'
  /**
   * Controlled open state; ignoring a reported `false` desyncs from the trigger, and a `true`
   * against `disabled` is refused and reported back as `false`. Omit both props for uncontrolled.
   */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function ImporterMenu({
  label,
  options,
  variant = 'primary',
  size = 'md',
  disabled,
  className,
  trigger = 'button',
  open,
  onOpenChange,
}: ImporterMenuProps) {
  const triggerRef = useRef<ComponentRef<typeof PopoverTrigger>>(null)
  const openRef = useRef(open)
  useLayoutEffect(() => {
    openRef.current = open
  }, [open])

  // Root has no controlled `open` prop — sync through the trigger ref's imperative open()/close().
  // close() reports `false` via handleOpenChange; reporting a refused `true` keeps a disabled
  // parent's stale `true` from reopening the menu once re-enabled.
  useEffect(() => {
    if (open === true && !disabled) triggerRef.current?.open()
    else if (open === false || disabled) triggerRef.current?.close()
  }, [open, disabled])

  // Filters the sync effect's re-drive, which would otherwise echo each open/close twice.
  const handleOpenChange = (next: boolean) => {
    if (next !== openRef.current) onOpenChange?.(next)
  }

  const triggerElement =
    trigger === 'icon' ? (
      <PopoverTrigger ref={triggerRef} asChild>
        <IconAction
          icon={Plus}
          label={label}
          size={size}
          disabled={disabled}
          className={className}
        />
      </PopoverTrigger>
    ) : (
      <PopoverTrigger ref={triggerRef} asChild>
        <Button variant={variant} size={size} disabled={disabled} className={className}>
          <Text>{label}</Text>
          <Icon as={ChevronDown} size="sm" />
        </Button>
      </PopoverTrigger>
    )

  return (
    <Popover onOpenChange={handleOpenChange}>
      {/* IconAction's own title only covers its disabled+reason case — wrap outside
          the asChild target so the trigger label still surfaces as a hover tooltip. */}
      {trigger === 'icon' ? (
        <ReasonTooltip reason={label}>{triggerElement}</ReasonTooltip>
      ) : (
        triggerElement
      )}
      <PopoverContent align={trigger === 'icon' ? 'end' : 'start'} className="w-72 p-1">
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
