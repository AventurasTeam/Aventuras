import { Info } from 'lucide-react-native'
import { View } from 'react-native'

import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'

/**
 * Inline step-level notice — `notice info` in the wizard wireframes.
 * Polite, not assertive: these appear and clear as the user edits, and an
 * alert would interrupt on every keystroke that changes the gate.
 */
export function StepNotice({ message }: { message: string }) {
  return (
    <View
      role="status"
      aria-live="polite"
      className="flex-row items-start gap-2 rounded-r-md border-l-4 border-l-border-strong bg-bg-sunken px-3 py-2.5"
    >
      <Icon as={Info} size="sm" className="mt-0.5 shrink-0 text-fg-muted" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {message}
      </Text>
    </View>
  )
}
