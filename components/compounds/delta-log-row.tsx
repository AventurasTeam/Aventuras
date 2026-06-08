import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type DeltaOp = 'create' | 'update' | 'delete'

// Mirrors the canonical union in lib/actions (DeltaSource). Kept local so this
// presentational compound stays decoupled from the action layer; v1's data model
// is frozen, so the two won't drift.
type DeltaSource =
  | 'ai_classifier'
  | 'periodic_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'chapter_close'

type Delta = {
  id: string
  op: DeltaOp
  source: DeltaSource
  /** Host's resolution call; compound uses it as fallback label only. */
  targetTable: string
  /** Host pre-resolves `target_table` + `target_id` to a display name. */
  targetDisplayName: string
  /** `op=update`: e.g. "state.traits[2]". `op=create`/`delete`: null. */
  fieldPath: string | null
  /** Pre-rendered diff prose, host-formatted. */
  summary: string
  /** Pre-formatted "entry #47"-style label; null for non-entry events. */
  entryId: string | null
  /** Pre-formatted "2h ago" / "12 Apr 14:33". */
  createdAtRelative: string
  /** Included for future grouping cue; v1 renders flat. */
  actionId: string
}

type DeltaLogRowProps = {
  delta: Delta
  /**
   * Host wires navigation. Undefined renders a non-interactive row
   * (no hover, no press affordance).
   */
  onPress?: () => void
  className?: string
}

const OP_STYLES: Record<DeltaOp, { container: string; label: string }> = {
  create: { container: 'bg-success', label: 'text-success-fg' },
  update: { container: 'bg-accent', label: 'text-accent-fg' },
  delete: { container: 'bg-danger', label: 'text-danger-fg' },
}

const SOURCE_LABEL: Record<DeltaSource, string> = {
  ai_classifier: 'classifier',
  periodic_classifier: 'periodic classifier',
  user_edit: 'user',
  lore_agent: 'lore agent',
  chapter_close: 'chapter close',
}

export function DeltaLogRow({ delta, onPress, className }: DeltaLogRowProps) {
  const interactive = onPress != null
  const op = OP_STYLES[delta.op]

  const metaParts = [
    SOURCE_LABEL[delta.source],
    delta.entryId != null ? delta.entryId : null,
    delta.createdAtRelative,
  ].filter((part): part is string => part != null)

  return (
    <Pressable
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      aria-label={`${delta.op} ${delta.targetDisplayName}`}
      className={cn(
        'flex-row items-start gap-2.5 px-row-x-md py-row-y-md',
        interactive && 'active:bg-tint-press',
        Platform.select({ web: interactive ? 'cursor-pointer hover:bg-tint-hover' : '' }),
        className,
      )}
    >
      <View className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5', op.container)}>
        <Text className={cn('text-xs font-medium', op.label)}>{delta.op}</Text>
      </View>

      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-1.5">
          <Text className="shrink font-medium" numberOfLines={1}>
            {delta.targetDisplayName}
          </Text>
          {delta.fieldPath != null ? (
            <>
              <Text variant="muted" size="sm">
                ·
              </Text>
              <Text variant="muted" size="sm" numberOfLines={1} className="shrink">
                {delta.fieldPath}
              </Text>
            </>
          ) : null}
        </View>

        <Text size="sm" numberOfLines={2}>
          {delta.summary}
        </Text>

        <Text variant="muted" size="xs" numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>
      </View>
    </Pressable>
  )
}

export type { Delta, DeltaLogRowProps, DeltaOp, DeltaSource }
