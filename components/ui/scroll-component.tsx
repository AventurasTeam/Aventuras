import { createContext, useContext, type ComponentType, type Ref } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'

// Lets a host swap the scroll container a list renders: on native, a fixed-detent bottom Sheet
// provides gorhom's scroll view so a list inside it coordinates with drag-down.

/** All a list may call on its scroll ref: gorhom's scroll view lacks most ScrollView methods. */
export type ScrollComponentHandle = Pick<ScrollView, 'scrollTo'>
export type ScrollComponent = ComponentType<ScrollViewProps & { ref?: Ref<ScrollComponentHandle> }>
export const ScrollComponentContext = createContext<ScrollComponent>(ScrollView)

/** The host's scroll container, read where it renders: inside a fixed-detent Sheet, the Sheet's. */
export function ContextScrollView(props: ScrollViewProps) {
  const Scroll = useContext(ScrollComponentContext)
  return <Scroll {...props} />
}
