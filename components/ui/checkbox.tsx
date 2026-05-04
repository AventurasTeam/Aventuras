import * as CheckboxPrimitive from '@rn-primitives/checkbox'
import { Check } from 'lucide-react-native'
import { Platform } from 'react-native'

import { Icon } from '@/components/ui/icon'
import type { DensityValue } from '@/lib/density/types'
import { useDensity } from '@/lib/density/use-density'
import { cn } from '@/lib/utils'

const DEFAULT_HIT_SLOP = 24

const BOX_SIZE_CLASSES: Record<DensityValue, string> = {
  compact: 'size-4',
  regular: 'size-5',
  comfortable: 'size-6',
}
const CHECK_ICON_SIZE: Record<DensityValue, number> = {
  compact: 12,
  regular: 14,
  comfortable: 16,
}

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  className?: string
  // RN's Pressable type doesn't include aria-invalid; surface
  // explicitly so consumers can drive error state through ARIA.
  // The primitive reads this prop directly and applies the danger
  // border rather than relying on the attribute reaching the DOM.
  'aria-invalid'?: boolean | 'true' | 'false'
}

export function Checkbox({ className, ...props }: CheckboxProps) {
  const { resolved } = useDensity()
  const ariaInvalidProp = props['aria-invalid']
  const isInvalid = ariaInvalidProp === true || ariaInvalidProp === 'true'
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'shrink-0 rounded-[4px] border border-border bg-bg-base',
        BOX_SIZE_CLASSES[resolved],
        Platform.select({
          web: 'focus-visible:ring-focus-ring/50 peer cursor-pointer outline-none transition-shadow focus-visible:border-accent focus-visible:ring-[3px] disabled:cursor-not-allowed',
          native: 'overflow-hidden',
        }),
        props.checked && 'border-accent',
        isInvalid && 'border-danger',
        props.disabled && 'opacity-50',
        className,
      )}
      hitSlop={DEFAULT_HIT_SLOP}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="h-full w-full items-center justify-center bg-accent">
        <Icon
          as={Check}
          size={CHECK_ICON_SIZE[resolved]}
          strokeWidth={Platform.OS === 'web' ? 2.5 : 3.5}
          className="text-accent-fg"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export type { CheckboxProps }
