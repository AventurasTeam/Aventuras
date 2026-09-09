import { View } from 'react-native'

import { Textarea, type TextareaProps } from '@/components/ui/textarea'

import { EmbedWindowCounter } from './embed-window-counter'

/**
 * A `Textarea` that reports how close its text is to the embedder's input window.
 *
 * A compound rather than a prop on `Textarea`: the counter row has to be mounted
 * on every render to avoid remounting the field mid-entry, and owning the wrapper
 * is what guarantees that rather than trusting each consumer to compose it right.
 * A surface that already has a stable wrapper of its own can place
 * `EmbedWindowCounter` directly instead — the reader's composer does.
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
