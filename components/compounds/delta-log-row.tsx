import * as React from 'react'
import { Platform, Pressable, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type DeltaOp = 'create' | 'update' | 'delete'

type DeltaSource =
  | 'ai_classifier'
  | 'user_edit'
  | 'lore_agent'
  | 'memory_compaction'
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

// Op badge color mapping. Filled-surface pattern: `bg-X` paired
// with `text-X-fg` for guaranteed contrast (each theme's --X-fg is
// tuned for legibility on --X). Same pattern as filled Button +
// selected Chip. Pattern doc names tokens as `bg-X-bg` shorthand;
// the live tokens are `bg-X` (the DEFAULT slot) — followup tracks
// the doc fix.
const OP_STYLES: Record<DeltaOp, { container: string; label: string }> = {
  create: { container: 'bg-success', label: 'text-success-fg' },
  update: { container: 'bg-accent', label: 'text-accent-fg' },
  delete: { container: 'bg-danger', label: 'text-danger-fg' },
}

// Source enum → label. Owned by the compound (5 bounded values per
// pattern doc). Host sends the raw enum; compound renders the
// human-readable label uniformly across surfaces.
const SOURCE_LABEL: Record<DeltaSource, string> = {
  ai_classifier: 'classifier',
  user_edit: 'user',
  lore_agent: 'lore agent',
  memory_compaction: 'memory compaction',
  chapter_close: 'chapter close',
}

// Aventuras's history-tab row. Read-only by design — rollback lives
// in the reader's per-entry path. Takes pre-formatted display
// strings opaque (same contract as EntryCard's worldTimeLabel and
// StoryCard's chapterLabel/lastOpenedRelative): per-target
// resolution and diff humanization happen in the host where the
// domain knowledge lives. Compound owns layout + op-color +
// source-enum mapping.
export function DeltaLogRow({ delta, onPress, className }: DeltaLogRowProps) {
  const interactive = onPress != null
  const op = OP_STYLES[delta.op]

  // Meta line parts. Source always present; entry link conditional
  // (null for non-entry-triggered events like chapter_close); time
  // always present. Joined with middle-dot separators downstream.
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
        // State-layer tints only fire when interactive — read-only
        // rows don't need hover/press affordance.
        interactive && 'active:bg-tint-press',
        Platform.select({ web: interactive ? 'cursor-pointer hover:bg-tint-hover' : '' }),
        className,
      )}
    >
      {/* Op badge — left-anchored, top-aligned with the target line.
          Pill shape (rounded-full), filled with op color, label in
          contrasting text-fg. mt-0.5 nudges baseline-aligned with
          the target text since `text-xs font-medium` on a 14 px
          base text shifts perceived center slightly upward. */}
      <View className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5', op.container)}>
        <Text className={cn('text-xs font-medium', op.label)}>{delta.op}</Text>
      </View>

      <View className="min-w-0 flex-1 gap-0.5">
        {/* Target line: name · field path. fieldPath is muted and
            truncates separately so a long path doesn't push the
            target name out of view. */}
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

        {/* Summary — host-formatted diff prose. 2-line ellipsis bound
            per pattern doc. */}
        <Text size="sm" numberOfLines={2}>
          {delta.summary}
        </Text>

        {/* Meta line — source · entry · time. Middle-dot separators
            embedded in the joined string keep them part of the same
            text run, avoiding awkward wraps where a separator gets
            isolated on its own line. */}
        <Text variant="muted" size="xs" numberOfLines={1}>
          {metaParts.join(' · ')}
        </Text>
      </View>
    </Pressable>
  )
}

export type { DeltaLogRowProps, Delta, DeltaOp, DeltaSource }
