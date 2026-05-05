import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Custom token families registered with tailwind-merge so `cn()`
// dedupes them against their built-in counterparts. Without this,
// e.g. `cn('pl-row-x-md', 'pl-8')` keeps both classes in the
// className string (tailwind-merge has no way to know
// `pl-row-x-md` belongs to the `pl-*` class group), and the cascade
// picks one unpredictably — silent override failures across the
// codebase. Source of truth for which tokens exist is
// `tailwind.config.js`; if a new token family is added there, mirror
// it here.

const CONTROL_HEIGHT_VALUES = [
  'control-xs',
  'control-sm',
  'control-md',
  'control-lg',
  'icon-action-sm',
  'icon-action-md',
  'icon-action-lg',
] as const

// Row padding tokens — `row-x-*` is registered as a horizontal
// padding value, `row-y-*` as vertical. They're keyed off the same
// density-aware vars regardless of which side a consumer applies
// them, so register in every related class group (`pl` / `pr` / `px`
// for horizontal, `pt` / `pb` / `py` for vertical) so dedupe works
// no matter which prefix a consumer picks.
const ROW_X_VALUES = ['row-x-xs', 'row-x-sm', 'row-x-md', 'row-x-lg'] as const
const ROW_Y_VALUES = ['row-y-xs', 'row-y-sm', 'row-y-md', 'row-y-lg'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      h: [{ h: [...CONTROL_HEIGHT_VALUES] }],
      w: [{ w: [...CONTROL_HEIGHT_VALUES] }],
      'min-h': [{ 'min-h': [...CONTROL_HEIGHT_VALUES] }],
      pl: [{ pl: [...ROW_X_VALUES] }],
      pr: [{ pr: [...ROW_X_VALUES] }],
      px: [{ px: [...ROW_X_VALUES] }],
      pt: [{ pt: [...ROW_Y_VALUES] }],
      pb: [{ pb: [...ROW_Y_VALUES] }],
      py: [{ py: [...ROW_Y_VALUES] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
