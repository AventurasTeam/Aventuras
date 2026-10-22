/**
 * The colour of each feature that has one, shared by the control that opens a feature's modal
 * and the action inside it, so the two cannot drift apart. One colour per mode, the same in every
 * theme of that mode: recognising the trigger's colour comes before the label's contrast on its
 * wash. See docs/development/ui-components.md, "Feature colours".
 *
 * Class strings are written out whole so Tailwind finds them.
 */

/** A tone named after its trigger, or, for a trigger with no colour, after what the action does. */
export type FeatureTone = 'branch' | 'regenerate' | 'checkpoint' | 'delete' | 'overwrite'

export type ActionTone = 'default' | FeatureTone

export interface FeatureColor {
  /** The colour as text or an icon's stroke. */
  text: string
  /** A trigger in the colour darkens one shade on hover. */
  hoverText: string
  /** The colour on hover only, for a trigger that is muted at rest. */
  revealText: string
  /** Sets `--feature`, which the button's `feature` variant washes and labels with. */
  vars: string
}

export const FEATURE_COLORS: Record<FeatureTone, FeatureColor> = {
  branch: {
    text: 'text-amber-700 dark:text-amber-500',
    hoverText: 'hover:text-amber-800 dark:hover:text-amber-600',
    revealText: 'hover:text-amber-700 dark:hover:text-amber-500',
    vars: '[--feature:var(--color-amber-700)] dark:[--feature:var(--color-amber-500)]',
  },
  regenerate: {
    text: 'text-amber-700 dark:text-amber-500',
    hoverText: 'hover:text-amber-800 dark:hover:text-amber-600',
    revealText: 'hover:text-amber-700 dark:hover:text-amber-500',
    vars: '[--feature:var(--color-amber-700)] dark:[--feature:var(--color-amber-500)]',
  },
  checkpoint: {
    text: 'text-blue-700 dark:text-blue-400',
    hoverText: 'hover:text-blue-800 dark:hover:text-blue-500',
    revealText: 'hover:text-blue-700 dark:hover:text-blue-400',
    vars: '[--feature:var(--color-blue-700)] dark:[--feature:var(--color-blue-400)]',
  },
  delete: {
    text: 'text-red-600 dark:text-red-400',
    hoverText: 'hover:text-red-700 dark:hover:text-red-500',
    revealText: 'hover:text-red-600 dark:hover:text-red-400',
    vars: '[--feature:var(--color-red-600)] dark:[--feature:var(--color-red-400)]',
  },
  // Shares delete's red until the feature palette decides whether it keeps a colour of its own.
  overwrite: {
    text: 'text-red-600 dark:text-red-400',
    hoverText: 'hover:text-red-700 dark:hover:text-red-500',
    revealText: 'hover:text-red-600 dark:hover:text-red-400',
    vars: '[--feature:var(--color-red-600)] dark:[--feature:var(--color-red-400)]',
  },
}
