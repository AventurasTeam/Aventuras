import { useMemo } from 'react'
import { View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { copyText } from '@/lib/clipboard'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

import { formatJSON } from './json-block-format'

type JSONBlockProps = {
  /** Object to pretty-print. Stringified with `JSON.stringify(_, null, 2)`; falls back to `String(data)` for circular refs. */
  data: unknown
  className?: string
}

export function JSONBlock({ data, className }: JSONBlockProps) {
  const formatted = useMemo(() => formatJSON(data), [data])

  return (
    <View className={cn('relative', className)}>
      <View className="absolute right-0 top-3 z-10">
        <Button variant="secondary" size="sm" onPress={() => void copyText(formatted)}>
          <Text>{t('common:clipboard.copy')}</Text>
        </Button>
      </View>
      <Text className="py-3 pr-16 font-mono text-xs text-fg-secondary">{formatted}</Text>
    </View>
  )
}

export type { JSONBlockProps }
