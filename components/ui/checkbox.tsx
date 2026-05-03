// Aventuras Checkbox primitive — reshaped from react-native-reusables
// baseline (which itself wraps @rn-primitives/checkbox). Boolean
// affordance distinct from Switch — used for multi-select lists,
// "I agree" gating, etc.
//
// Reshape per docs/ui/components.md sourcing rules:
//
// - RESHAPED: color tokens (border-input/bg-input/30/border-primary/
//   bg-primary/primary-foreground/focus-visible ring/aria-invalid
//   destructive ring → border-border/border-accent/bg-accent/
//   accent-fg/focus-ring/danger). Shadow classes stripped
//   (Aventuras flat-depth principle). Dark-mode opacity dance
//   (`dark:bg-input/30`, `dark:aria-invalid:ring-destructive/40`)
//   stripped — the theme registry handles light/dark per-theme.
// - AUGMENTED (per components.md augmentation policy): error
//   styling driven from JS via `aria-invalid` prop reading rather
//   than the CSS `aria-invalid:` Tailwind variant. RN-Web doesn't
//   reliably forward arbitrary aria-* attributes from rn-primitives
//   wrappers, so the attribute selector silently misses; matches
//   Input + Textarea's reliability strategy.
// - ACCEPTED: rn-primitives composition (Root + Indicator), the
//   fixed `size-4` square + `rounded-[4px]` corner radius, the
//   `hitSlop={24}` boost from the baseline (mobile tap-target),
//   `disabled:cursor-not-allowed` on web,
//   `overflow-hidden` on native (clips the indicator pill).
// - SUBTRACTED: the baseline's `checkedClassName` /
//   `indicatorClassName` / `iconClassName` pass-throughs. v1
//   doesn't need per-checkbox style overrides; consumers pass
//   `className` to the Root and that's enough. Re-add the slots
//   if a real consumer demands them.

import * as CheckboxPrimitive from '@rn-primitives/checkbox'
import { Check } from 'lucide-react-native'
import { Platform } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'

const DEFAULT_HIT_SLOP = 24

type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive.Root> & {
  className?: string
  // RN's Pressable type doesn't include aria-invalid; surface
  // explicitly so consumers can drive error state through ARIA.
  // The primitive reads this prop directly and applies the danger
  // border rather than relying on the attribute reaching the DOM.
  'aria-invalid'?: boolean | 'true' | 'false'
}

export function Checkbox({ className, ...props }: CheckboxProps) {
  const ariaInvalidProp = props['aria-invalid']
  const isInvalid = ariaInvalidProp === true || ariaInvalidProp === 'true'
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'size-4 shrink-0 rounded-[4px] border border-border bg-bg-base',
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
          size={12}
          strokeWidth={Platform.OS === 'web' ? 2.5 : 3.5}
          className="text-accent-fg"
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export type { CheckboxProps }
