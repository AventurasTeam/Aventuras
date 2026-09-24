import { setStringAsync as setClipboardString } from 'expo-clipboard'
import { useCallback, useMemo } from 'react'
import { Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import { formatJSON } from './json-block-format'

type JSONBlockProps = {
  /** Object to pretty-print. Stringified with `JSON.stringify(_, null, 2)`; falls back to `String(data)` for circular refs. */
  data: unknown
  className?: string
}

export function JSONBlock({ data, className }: JSONBlockProps) {
  const formatted = useMemo(() => formatJSON(data), [data])

  const handleCopy = useCallback(() => {
    if (Platform.OS === 'web') {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(formatted).catch(() => {})
      }
      return
    }
    setClipboardString(formatted).catch(() => {})
  }, [formatted])

  return (
    <View className={cn('relative', className)}>
      <View className="absolute right-0 top-3 z-10">
        <Button variant="secondary" size="sm" onPress={handleCopy}>
          <Text>Copy</Text>
        </Button>
      </View>
      <Text className="py-3 pr-16 font-mono text-xs text-fg-secondary">{formatted}</Text>
    </View>
  )
}

export type { JSONBlockProps }
