import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { useEmbedInputPressure } from '@/hooks/use-embed-input-pressure'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { counterLabel, type CounterVariant } from './embed-window-label'

type EmbedWindowCounterProps = {
  /** The text as the embedder will receive it. */
  text: string
  variant?: CounterVariant
}

/**
 * A reserved row that reports how close `text` is to the embedder's input window.
 *
 * **Render it unconditionally.** The row always occupies its space and only the
 * label's opacity moves, because the counter first appears while someone is
 * mid-entry: gating it on the pressure would change the tree around a sibling
 * `TextInput` at exactly that moment, remounting it and taking focus and cursor
 * with it (`lessons-learned/input-adornment-dom-identity.md`). Reserving the row
 * also keeps the field from jumping when the label arrives.
 */
export function EmbedWindowCounter({ text, variant = 'document' }: EmbedWindowCounterProps) {
  const measured = useEmbedInputPressure(text)
  const label = counterLabel(measured, variant)
  const visible = measured.pressure !== 'ok' && label !== null

  return (
    <View className="flex-row justify-end">
      <Text
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        className={cn(
          'text-xs',
          measured.pressure === 'over' ? 'text-danger' : 'text-fg-muted',
          !visible && 'opacity-0',
        )}
      >
        {/* An empty Text collapses to zero height, so the field would still jump
            the first time a label arrives. */}
        {label === null ? '\u00a0' : t(label.key, label.values)}
      </Text>
    </View>
  )
}
