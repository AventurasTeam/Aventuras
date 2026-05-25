import { AlertTriangle } from 'lucide-react-native'
import { useEffect, useMemo } from 'react'
import { Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type SaveBarProps = {
  /**
   * Field labels in user-recognizable copy — comma-separated in
   * the dirty-note. e.g. `['description', 'visual.hair', 'traits']`.
   * Empty array hides the field listing but still shows the count.
   */
  dirtyFields: readonly string[]
  /**
   * Total dirty change count. Defaults to `dirtyFields.length`.
   * Override when a single field accumulates multiple distinct
   * changes that should count individually.
   */
  dirtyCount?: number
  /**
   * Optional informational note. Renders as a `⚠` icon after the
   * field list with the text shown via web tooltip / aria-label.
   */
  notice?: string
  onSave: () => void
  onDiscard: () => void
  /**
   * Saving in flight — disables both actions and suppresses the
   * keyboard shortcut.
   */
  saving?: boolean
  className?: string
}

export function SaveBar({
  dirtyFields,
  dirtyCount,
  notice,
  onSave,
  onDiscard,
  saving = false,
  className,
}: SaveBarProps) {
  const count = dirtyCount ?? dirtyFields.length
  const fieldList = dirtyFields.length > 0 ? dirtyFields.join(', ') : null

  useEffect(() => {
    if (Platform.OS !== 'web') return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        e.stopPropagation()
        if (!saving) onSave()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [onSave, saving])

  const shortcutHint = useMemo(() => {
    if (Platform.OS !== 'web') return null
    const isMac =
      typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent ?? '')
    return isMac ? '⌘S' : 'Ctrl+S'
  }, [])

  return (
    <View
      role="status"
      aria-live="polite"
      className={cn(
        'relative flex-row items-center justify-between gap-3 border-t border-border px-row-x-md py-row-y-sm',
        className,
      )}
    >
      <View
        className="absolute inset-0 bg-warning opacity-[.12]"
        aria-hidden
        pointerEvents="none"
      />

      <View className="min-w-0 shrink flex-row items-center gap-2">
        <View className="h-2 w-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <Text size="xs" numberOfLines={1} className="shrink">
          <Text size="xs" className="font-semibold text-fg-primary">
            {count} unsaved change{count === 1 ? '' : 's'}
          </Text>
          {fieldList != null ? (
            <Text size="xs" variant="secondary">
              {' — '}
              {fieldList}
            </Text>
          ) : null}
        </Text>
        {notice != null ? (
          Platform.OS === 'web' ? (
            <div title={notice} className="inline-flex" aria-label={notice}>
              <Icon as={AlertTriangle} size="sm" className="text-warning" />
            </div>
          ) : (
            <View aria-label={notice}>
              <Icon as={AlertTriangle} size="sm" className="text-warning" />
            </View>
          )
        ) : null}
      </View>

      <View className="shrink-0 flex-row items-center gap-2">
        <Button variant="secondary" size="sm" onPress={onDiscard} disabled={saving}>
          <Text>Discard</Text>
        </Button>
        <Button variant="primary" size="sm" onPress={onSave} disabled={saving}>
          <Text>Save{shortcutHint != null ? ` ${shortcutHint}` : ''}</Text>
        </Button>
      </View>
    </View>
  )
}

export type { SaveBarProps }
