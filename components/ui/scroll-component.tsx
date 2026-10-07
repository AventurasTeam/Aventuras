import { createContext, type ComponentType, type Ref } from 'react'
import { ScrollView, type ScrollViewProps } from 'react-native'

// Lets a host swap the scroll container a list renders without changing the list: the bottom
// Sheet provides gorhom's scroll view so a list inside it coordinates with drag-down.
export type ScrollComponent = ComponentType<ScrollViewProps & { ref?: Ref<ScrollView> }>
export const ScrollComponentContext = createContext<ScrollComponent>(ScrollView)
