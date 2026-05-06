import { ChevronDown } from 'lucide-react-native'
import * as React from 'react'
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
   * Web-only browser tooltip when the option is disabled. Mirrors
   * IconAction's `disabledReason` affordance — a real Tooltip
   * primitive lands later.
   */
  disabledReason?: string
  /**
   * Caller-supplied action. Menu auto-closes after invocation.
   * Receiving `undefined` is allowed (handy for stub options) — the
   * menu still closes; nothing else fires.
   */
  onPress?: () => void
}

type ImporterMenuProps = {
  /** Trigger button label, e.g. `+ New character`, `+ Add calendar`. */
  label: string
  /** Action items rendered in the popover, in order. */
  options: readonly ImporterMenuOption[]
  /**
   * Trigger Button variant. Defaults to `primary` since these are
   * the prominent surface-level actions (`+ New X`, `+ Add Y`,
   * `Import …`).
   */
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  /** External disabled state — e.g. permission / write-lock gating. */
  disabled?: boolean
  className?: string
}

// ImporterMenu — trigger button + popover menu of import options.
// Spec context: docs/ui/patterns/data.md → Import counterparts.
//
// **Scope: menu shell only.** This compound owns the visual + a11y
// shape of the affordance (button-with-chevron, popover-anchored
// menu, label / description / disabled-reason per option). It does
// NOT own the actions themselves: file pickers, paste handlers,
// schema validation, Vault dispatch, and the rest of the import
// pipeline are caller-supplied via each option's `onPress`. A
// fuller `Importer` wrapper that integrates those pieces is deferred
// — the surfaces that need it (per-row World/Plot, calendar add,
// story import) all want different action sets, so a single
// "everything-included" compound would be premature.
//
// Common option set for entity-style per-row imports:
//   `[{ key: 'blank',  label: 'Blank',           onPress: openBlankForm },
//     { key: 'json',   label: 'From JSON file…', onPress: openFilePicker },
//     { key: 'vault',  label: 'From Vault…',     disabled: true,
//       disabledReason: 'Vault library coming later.' }]`
export function ImporterMenu({
  label,
  options,
  variant = 'primary',
  size = 'md',
  disabled,
  className,
}: ImporterMenuProps) {
  // @rn-primitives/popover's Root is uncontrolled — there's no
  // `open` prop, only an `onOpenChange` callback. The Trigger's
  // imperative ref exposes `close()` which is how we dismiss the
  // menu after an option fires.
  const triggerRef = React.useRef<React.ComponentRef<typeof PopoverTrigger>>(null)

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
      // Inline pointerEvents per the project's rn-primitives gap
      // memo: rn-primitives wrappers don't fully gate disabled
      // clicks on web; the inline style is the reliable bypass.
      style={isDisabled ? { pointerEvents: 'none' } : undefined}
      className={cn(
        // Density-aware paddings + a `min-h` floor that lifts to
        // the touch-target tier (`control-h-lg` ≥ 44 px) on phone,
        // mirroring the Autocomplete suggestion-row pattern. The
        // padding tokens flex with the global density toggle so
        // compact / regular / comfortable settings all read right.
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

  // Web tooltip via raw div + `title` attr — same pattern IconAction
  // uses (RN-Web `<View>`/`<Pressable>` filter unknown HTML attrs,
  // so the prop never reaches the DOM).
  if (isDisabled && option.disabledReason && Platform.OS === 'web') {
    return (
      <div title={option.disabledReason} style={{ display: 'flex' }}>
        {row}
      </div>
    )
  }
  return row
}

export type { ImporterMenuOption, ImporterMenuProps }
