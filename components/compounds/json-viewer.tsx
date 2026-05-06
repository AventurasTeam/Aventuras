import * as Clipboard from 'expo-clipboard'
import { X } from 'lucide-react-native'
import * as React from 'react'
import { Platform, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { IconAction } from '@/components/ui/icon-action'
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

// Raw JSON viewer — the shared drawer behind every "View raw JSON"
// affordance per docs/ui/patterns/data.md → Raw JSON viewer.
//
// Read-only in v1. The footer hint placeholder ("Edit raw — coming
// later") is the spec'd disabled affordance for the deferred edit
// mode (raw-edit + zod-validate on save).
//
// Tier-adapted shape:
//   • Tablet / desktop — right-anchored 440 px drawer (matches the
//     reader peek drawer for visual consistency). Header carries
//     Copy + explicit close ×; mouse needs an obvious dismiss target.
//   • Phone — tall bottom sheet. The drag handle (rendered by Sheet
//     itself) plus tap-overlay are the natural dismiss gestures, so
//     the explicit × is dropped — keeping it would be redundant
//     chrome competing with the gesture affordance.
//
// Body keeps Sheet's default `p-6`. Header / footer carry their own
// border-b / border-t lines (inset within the padding rather than
// bleeding to the panel edges) so the structure is a flat sequence
// of Content children with the ScrollView in the middle claiming
// the remaining height via `flex-1`.
export function JSONViewer({ open, onOpenChange, name, data, className }: JSONViewerProps) {
  const tier = useTier()
  const anchor = tier === 'phone' ? 'bottom' : 'right'
  const showCloseButton = anchor !== 'bottom'

  const formatted = React.useMemo(() => {
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      // JSON.stringify throws on circular refs. Coercing to String
      // keeps the drawer functional rather than crashing the host
      // surface; the result will be `[object Object]` or similar,
      // which is the right "something's off" signal until edit-mode
      // adds proper validation.
      return String(data)
    }
  }, [data])

  const handleCopy = React.useCallback(() => {
    if (Platform.OS === 'web') {
      // expo-clipboard's web shim is async too, but going through
      // navigator.clipboard directly avoids a wrapper layer for the
      // path that handles 99 % of viewer traffic (desktop drawer).
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(formatted).catch(() => {})
      }
      return
    }
    Clipboard.setStringAsync(formatted).catch(() => {})
  }, [formatted])

  const handleClose = React.useCallback(() => onOpenChange(false), [onOpenChange])

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
          <View className="shrink-0 flex-row items-center gap-1">
            <Button variant="secondary" size="sm" onPress={handleCopy}>
              <Text>Copy</Text>
            </Button>
            {showCloseButton ? (
              <IconAction icon={X} label="Close raw JSON viewer" onPress={handleClose} />
            ) : null}
          </View>
        </View>

        <ScrollView className="flex-1">
          <Text className="py-3 font-mono text-xs text-fg-secondary">{formatted}</Text>
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
