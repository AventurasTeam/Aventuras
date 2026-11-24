import { GitBranch } from 'lucide-react-native'
import type { ReactElement, Ref } from 'react'
import { Platform, Pressable, View, type PressableProps, type ViewProps } from 'react-native'

import { CHIP_HIT_SLOP } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Text } from '@/components/ui/text'
import { POINTER_EVENTS_NONE } from '@/constants/styles'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type BranchChipProps = Omit<PressableProps, 'children'> & {
  count: number
  currentName: string
  /** Whether the navigator it opens is open. */
  expanded?: boolean
  ref?: Ref<View>
}

/** `⎇ N` among the reader's state chips; a story with one branch shows none. */
export function BranchChip({
  count,
  currentName,
  expanded = false,
  className,
  ...slotProps
}: BranchChipProps): ReactElement | null {
  if (count <= 1) return null
  const label = t('reader:branches.chipLabel', { name: currentName, count })
  return (
    <ReasonTooltip reason={label}>
      <Pressable
        testID="branch-chip"
        accessibilityRole="button"
        aria-label={label}
        aria-expanded={expanded}
        hitSlop={CHIP_HIT_SLOP}
        className={cn(
          'h-control-xs flex-row items-center gap-1.5 rounded-sm border border-border-strong bg-bg-base px-row-x-sm active:bg-tint-press',
          Platform.select({
            web: 'cursor-pointer outline-none transition-colors hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
          }),
          className,
        )}
        {...slotProps}
      >
        <Icon as={GitBranch} size="sm" className="text-fg-muted" />
        <Text size="xs" className="font-medium">
          {count}
        </Text>
      </Pressable>
    </ReasonTooltip>
  )
}

export type BranchNavigatorAnchorProps = Omit<ViewProps, 'children'> & { ref?: Ref<View> }

// What `PopoverTrigger asChild` injects to make its child a button; the anchor only gives a place.
const NOT_A_TRIGGER = { onPress: undefined, onClick: undefined, role: undefined } as object

/** Popover anchor while no chip shows: zero-width, inert, out of the a11y tree. */
export function BranchNavigatorAnchor({
  className,
  style,
  ...slotProps
}: BranchNavigatorAnchorProps): ReactElement {
  return (
    <View
      testID="branch-navigator-anchor"
      // A layout-only view can be flattened out of Android's native tree; the Popover measures it.
      collapsable={false}
      className={cn('h-control-xs w-0', className)}
      {...slotProps}
      {...NOT_A_TRIGGER}
      accessibilityRole="none"
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      tabIndex={-1}
      style={[style, POINTER_EVENTS_NONE]}
    />
  )
}
