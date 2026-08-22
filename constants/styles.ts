import type { ViewStyle } from 'react-native'

/**
 * RN-Web deprecated the `pointerEvents` prop in favour of the style key, and
 * `react-native/no-inline-styles` bans the object at the call site — so it must be a constant.
 * Merge last in a style array (`[layout, POINTER_EVENTS_NONE]`): RN resolves later over earlier.
 */
export const POINTER_EVENTS_NONE = { pointerEvents: 'none' as const } satisfies ViewStyle
export const POINTER_EVENTS_BOX_NONE = { pointerEvents: 'box-none' as const } satisfies ViewStyle
export const POINTER_EVENTS_AUTO = { pointerEvents: 'auto' as const } satisfies ViewStyle
