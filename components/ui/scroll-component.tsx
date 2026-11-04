import { createContext, useContext, type ComponentType, type Ref } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'

// Lets a host swap the scroll container a list renders: on native, a fixed-detent bottom Sheet
// provides gorhom's scroll view so a list inside it coordinates with drag-down.

/** What a list may call on its scroll ref; gorhom's ref is the native ScrollView, so it can grow. */
export type ScrollComponentHandle = Pick<ScrollView, 'scrollTo'>
type ScrollComponentProps = ScrollViewProps & { ref?: Ref<ScrollComponentHandle> }
export type ScrollComponent = ComponentType<ScrollComponentProps>
export const ScrollComponentContext = createContext<ScrollComponent>(ScrollView)

/** The host's scroll container, read where it renders: inside a fixed-detent Sheet, the Sheet's. */
export function ContextScrollView(props: ScrollComponentProps) {
  const Scroll = useContext(ScrollComponentContext)
  return <Scroll {...props} />
}
