import { View } from 'react-native'

import { Text } from '@/components/ui/text'
import { Textarea, type TextareaProps } from '@/components/ui/textarea'
import { useEmbedInputPressure } from '@/hooks/use-embed-input-pressure'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { counterLabel } from './embed-window-label'

/**
 * A `Textarea` that reports how close its text is to the embedder's input window.
 *
 * The counter is **always mounted** and only its opacity moves. Conditionally
 * rendering it would change the tree around the `TextInput` at the exact moment
 * someone is mid-entry, remounting it and taking focus and cursor with it — the
 * failure in `lessons-learned/input-adornment-dom-identity.md`. Reserving the row
 * unconditionally also keeps the field from jumping when the counter appears.
 *
 * A compound rather than a prop on `Textarea`: the wrapper has to exist on every
 * render for that to hold, and a consumer composing the two by hand is exactly
 * where it would stop holding.
 */
export function EmbedWindowTextarea({ value, ...props }: TextareaProps) {
  const measured = useEmbedInputPressure(typeof value === 'string' ? value : '')
  const label = counterLabel(measured)
  const visible = measured.pressure !== 'ok' && label !== null

  return (
    <View>
      <Textarea value={value} {...props} />
      <View className="mt-1 flex-row justify-end">
        <Text
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          className={cn(
            'text-xs',
            measured.pressure === 'over' ? 'text-danger' : 'text-fg-muted',
            !visible && 'opacity-0',
          )}
        >
          {label === null ? '' : t(label.key, label.values)}
        </Text>
      </View>
    </View>
  )
}
