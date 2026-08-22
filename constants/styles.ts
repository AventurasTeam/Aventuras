import type { ViewStyle } from 'react-native'

/**
 * Pointer-events as style objects, hoisted out of render.
 *
 * RN-Web deprecated the `pointerEvents` prop in favour of the style key, and
 * `react-native/no-inline-styles` bans writing the object at the call site — so every
 * consumer needs a module constant. Shared so the value has one spelling repo-wide:
 * four independent ones had drifted apart, three of which cast to `never` to dodge the
 * lint rule and silenced the type checker along with it.
 *
 * Merge these last in a style array (`[layout, POINTER_EVENTS_NONE]`) — RN resolves
 * later entries over earlier ones.
 */
export const POINTER_EVENTS_NONE = { pointerEvents: 'none' as const } satisfies ViewStyle
export const POINTER_EVENTS_BOX_NONE = { pointerEvents: 'box-none' as const } satisfies ViewStyle
export const POINTER_EVENTS_AUTO = { pointerEvents: 'auto' as const } satisfies ViewStyle
