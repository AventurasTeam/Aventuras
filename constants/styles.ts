import { StyleSheet, type ViewStyle } from 'react-native'

// RN-Web wants the style key, not the prop, and `no-inline-styles` bans the object at
// the call site. Merge last where another entry may set it — RN resolves later over earlier.
export const POINTER_EVENTS_NONE = { pointerEvents: 'none' as const } satisfies ViewStyle
// `box-none` isn't a CSS value: RN-Web polyfills it only in compiled styles and drops it
// inline, which leaves the view catching every click over its box.
export const POINTER_EVENTS_BOX_NONE = StyleSheet.create({
  boxNone: { pointerEvents: 'box-none' },
}).boxNone
export const POINTER_EVENTS_AUTO = { pointerEvents: 'auto' as const } satisfies ViewStyle

// For Reanimated `Animated.*`, where NativeWind drops `className`.
export const OVERFLOW_HIDDEN = { overflow: 'hidden' as const } satisfies ViewStyle
