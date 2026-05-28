import { X } from 'lucide-react-native'
import { useCallback } from 'react'
import { ScrollView, View } from 'react-native'

import { IconAction } from '@/components/ui/icon-action'
import { JSONBlock } from '@/components/ui/json-block'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'

type JSONViewerProps = {
  /** Controlled open state. Caller owns mount lifecycle. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Row name shown after `Raw JSON ·` in the header. Truncated with
   * ellipsis if it overflows the drawer width.
   */
  name: string
  /** Object to pretty-print. Stringified with `JSON.stringify(_, null, 2)`. */
  data: unknown
  className?: string
}

export function JSONViewer({ open, onOpenChange, name, data, className }: JSONViewerProps) {
  const tier = useTier()
  const anchor = tier === 'phone' ? 'bottom' : 'right'
  const showCloseButton = anchor !== 'bottom'

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent anchor={anchor} size="tall" title={`Raw JSON · ${name}`} className={className}>
        <View className="flex-row items-center gap-3 border-b border-border pb-3">
          <View className="min-w-0 flex-1 flex-row items-baseline gap-1">
            <Text numberOfLines={1} className="shrink-0 font-semibold">
              Raw JSON
            </Text>
            <Text variant="muted" className="shrink-0">
              ·
            </Text>
            <Text variant="secondary" numberOfLines={1} className="min-w-0 shrink">
              {name}
            </Text>
          </View>
          {showCloseButton ? (
            <View className="shrink-0">
              <IconAction icon={X} label="Close raw JSON viewer" onPress={handleClose} />
            </View>
          ) : null}
        </View>

        <ScrollView className="flex-1">
          <JSONBlock data={data} />
        </ScrollView>

        <View className="border-t border-border pt-3">
          <Text size="xs" variant="muted">
            Edit raw — coming later
          </Text>
        </View>
      </SheetContent>
    </Sheet>
  )
}

export type { JSONViewerProps }
