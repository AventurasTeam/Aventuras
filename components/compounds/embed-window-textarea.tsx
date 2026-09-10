import { View } from 'react-native'

import { Textarea, type TextareaProps } from '@/components/ui/textarea'

import { EmbedWindowCounter } from './embed-window-counter'

/**
 * A `Textarea` that reports how close its text is to the embedder's input window.
 *
 * A compound, not a `Textarea` prop: the counter must mount on every render or the
 * field remounts mid-entry. Surfaces with their own stable wrapper can place
 * `EmbedWindowCounter` directly.
 */
export function EmbedWindowTextarea({ value, ...props }: TextareaProps) {
  return (
    <View>
      <Textarea value={value} {...props} />
      <View className="mt-1">
        <EmbedWindowCounter text={typeof value === 'string' ? value : ''} />
      </View>
    </View>
  )
}
