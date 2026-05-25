import { Info, Search as SearchIcon } from 'lucide-react-native'
import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, type SelectOption } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

// Container threshold for the desktop-vs-narrow layout switch.
const NARROW_THRESHOLD_PX = 1024

type ToolbarSearchProps = {
  value: string
  onChange: (value: string) => void
  /**
   * Short, truncation-safe placeholder (≤ ~25 chars per
   * `lists.md → Search bar scope`). Names 1-2 most obvious fields;
   * the full scope list lives in the trailing ⓘ help.
   */
  placeholder: string
  /**
   * Searchable field names. Surfaces in the ⓘ help-popover content
   * as the canonical list. Empty array hides the ⓘ trigger entirely
   * (useful when a surface intentionally doesn't advertise scope).
   */
  scope: readonly string[]
  disabled?: boolean
  disabledReason?: string
  className?: string
}

function ScopeHelpTrigger({ scope, disabled }: { scope: readonly string[]; disabled?: boolean }) {
  const fieldList = scope.join(' · ')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Pressable
          disabled={disabled}
          accessibilityRole="button"
          aria-label="Search scope"
          hitSlop={12}
          className={cn(
            'p-1',
            Platform.select({ web: 'cursor-pointer outline-none' }),
            disabled && 'opacity-50',
          )}
        >
          <Icon as={Info} size="sm" className="text-fg-muted" />
        </Pressable>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <View className="gap-1">
          <Text size="sm" className="font-medium">
            Search scope
          </Text>
          <Text size="xs" variant="muted">
            {`Searches: ${fieldList}`}
          </Text>
        </View>
      </PopoverContent>
    </Popover>
  )
}

function ToolbarSearch({
  value,
  onChange,
  placeholder,
  scope,
  disabled,
  disabledReason,
  className,
}: ToolbarSearchProps) {
  const showScopeHelp = scope.length > 0
  const input = (
    <Input
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      editable={!disabled}
      leading={<Icon as={SearchIcon} size="sm" className="text-fg-muted" />}
      trailing={showScopeHelp ? <ScopeHelpTrigger scope={scope} disabled={disabled} /> : null}
      className={cn('w-full', className)}
    />
  )

  if (disabled && disabledReason && Platform.OS === 'web') {
    return (
      <div title={disabledReason} className="w-full">
        {input}
      </div>
    )
  }
  return input
}

type ToolbarFilterChipsProps = {
  className?: string
  children: ReactNode
}

function ToolbarFilterChips({ className, children }: ToolbarFilterChipsProps) {
  return <View className={cn('flex-row flex-wrap items-center gap-2', className)}>{children}</View>
}

type ToolbarSortProps = {
  value: string
  onChange: (value: string) => void
  options: readonly SelectOption[]
  /** Optional prefix label rendered muted before the selected value. */
  label?: string
  disabled?: boolean
  className?: string
}

function ToolbarSort({ value, onChange, options, label, disabled, className }: ToolbarSortProps) {
  return (
    <Select
      mode="dropdown"
      options={options as SelectOption[]}
      value={value}
      onValueChange={onChange}
      disabled={disabled}
      size="xs"
      className={className}
      // The `label` prop also drives the phone Sheet title — gives
      // the bottom-sheet a meaningful header when sorting on phone.
      label={label}
      renderTrigger={({ selected, placeholder }) => {
        const valueText = selected?.label ?? placeholder ?? ''
        if (label != null) {
          return (
            <View className="flex-row items-center gap-1">
              <Text size="sm" variant="muted">
                {`${label}:`}
              </Text>
              <Text size="sm" className="text-fg-primary">
                {valueText}
              </Text>
            </View>
          )
        }
        return (
          <Text size="sm" className="text-fg-primary">
            {valueText}
          </Text>
        )
      }}
    />
  )
}

type ToolbarProps = {
  className?: string
  children: ReactNode
}

function ToolbarRoot({ className, children }: ToolbarProps) {
  const initialTier = useTier()
  const [containerWidth, setContainerWidth] = useState<number | null>(null)
  const isNarrow =
    containerWidth != null ? containerWidth < NARROW_THRESHOLD_PX : initialTier !== 'desktop'

  let searchSlot: ReactNode = null
  let chipsSlot: ReactElement<{ children?: ReactNode }> | null = null
  let sortSlot: ReactNode = null
  const others: ReactNode[] = []

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === ToolbarSearch) searchSlot = child
    else if (child.type === ToolbarFilterChips) {
      chipsSlot = child as ReactElement<{ children?: ReactNode }>
    } else if (child.type === ToolbarSort) sortSlot = child
    else others.push(child)
  })

  return (
    <View
      className={cn('w-full', className)}
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
    >
      {isNarrow ? (
        <View className="gap-2">
          {searchSlot}
          {(chipsSlot != null || sortSlot != null) && (
            <View className="flex-row flex-wrap items-center gap-2">
              {(chipsSlot as ReactElement<{ children?: ReactNode }> | null)?.props.children ?? null}
              {sortSlot}
            </View>
          )}
          {others}
        </View>
      ) : (
        <View className="flex-row items-center gap-3">
          <View className="min-w-0 flex-1">{searchSlot}</View>
          {chipsSlot}
          {sortSlot}
          {others}
        </View>
      )}
    </View>
  )
}

const Toolbar = Object.assign(ToolbarRoot, {
  Search: ToolbarSearch,
  FilterChips: ToolbarFilterChips,
  Sort: ToolbarSort,
})

export { Toolbar }
export type { ToolbarFilterChipsProps, ToolbarSearchProps, ToolbarSortProps }
