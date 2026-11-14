import { useId, type ReactElement } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { describedBy } from '@/components/ui/accessible-description'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

type DeltaOp = 'create' | 'update' | 'delete'

// Mirrors the canonical union in lib/actions (DeltaSource). Kept local so this
// presentational compound stays decoupled from the action layer; v1's data model
// is frozen, so the two won't drift.
type DeltaSource =
  | 'ai_classifier'
  | 'piggyback_tagged_block'
  | 'per_turn_classifier'
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
  /** Pre-rendered diff prose, host-formatted. Empty drops the line and its description part. */
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
  /** On the outermost element, around the row and its footer. */
  className?: string
  /**
   * Under the row and outside its button, aligned to the summary column, so a control in it is
   * never nested in the row's. Adding or removing it leaves the row's button, and its focus, in
   * place.
   */
  footer?: ReactElement
  /** Default true; false drops the meta line from view and from the row's description. */
  showMeta?: boolean
  /** The summary's line clamp. Default 2; null for none. */
  summaryLines?: number | null
}

const OP_STYLES: Record<DeltaOp, { container: string; label: string }> = {
  create: { container: 'bg-success', label: 'text-success-fg' },
  update: { container: 'bg-accent', label: 'text-accent-fg' },
  delete: { container: 'bg-danger', label: 'text-danger-fg' },
}

/** `spacer`: an unannounced copy with no height, holding the badge's width on the footer line. */
function OpBadge({ op, label, spacer = false }: { op: DeltaOp; label: string; spacer?: boolean }) {
  const style = OP_STYLES[op]
  return (
    <View
      aria-hidden={spacer ? true : undefined}
      className={
        spacer
          ? 'h-0 shrink-0 overflow-hidden rounded-full px-2'
          : cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5', style.container)
      }
    >
      <Text className={cn('text-xs font-medium', style.label)}>{label}</Text>
    </View>
  )
}

export function DeltaLogRow({
  delta,
  onPress,
  className,
  footer,
  showMeta = true,
  summaryLines = 2,
}: DeltaLogRowProps) {
  const interactive = onPress != null
  const id = useId()
  const opLabel = t(`history:op.${delta.op}`)
  // Rows of one target read alike, so a pressable row's name carries its entry.
  const rowLabel =
    interactive && delta.entryId != null
      ? t('history:rowLabelWithEntry', {
          op: opLabel,
          name: delta.targetDisplayName,
          entry: delta.entryId,
        })
      : t('history:rowLabel', { op: opLabel, name: delta.targetDisplayName })

  const metaParts = [
    t(`history:source.${delta.source}`),
    delta.entryId != null ? delta.entryId : null,
    delta.createdAtRelative,
  ].filter((part): part is string => part != null)
  const meta = metaParts.join(' · ')
  const fieldId = `${id}-field`
  const summaryId = `${id}-summary`
  const metaId = `${id}-meta`
  const hasSummary = delta.summary !== ''
  const description = [
    ...(delta.fieldPath != null ? [{ id: fieldId, text: delta.fieldPath }] : []),
    ...(hasSummary ? [{ id: summaryId, text: delta.summary }] : []),
    ...(showMeta ? [{ id: metaId, text: meta }] : []),
  ]

  const content = (
    <>
      <OpBadge op={delta.op} label={opLabel} />

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
              <Text
                nativeID={fieldId}
                variant="muted"
                size="sm"
                numberOfLines={1}
                className="shrink"
              >
                {delta.fieldPath}
              </Text>
            </>
          ) : null}
        </View>

        {hasSummary ? (
          <Text nativeID={summaryId} size="sm" numberOfLines={summaryLines ?? undefined}>
            {delta.summary}
          </Text>
        ) : null}

        {showMeta ? (
          <Text nativeID={metaId} variant="muted" size="xs" numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </>
  )

  const hasFooter = footer != null
  const rowClassName = cn(
    'flex-row items-start gap-2.5 px-row-x-md',
    // The footer reads as the content column's next line, at its line gap.
    hasFooter ? 'pt-row-y-md pb-0.5' : 'py-row-y-md',
  )
  // Not a control, so nothing to name or disable: its text reads as it shows.
  const row = !interactive ? (
    <View testID="delta-log-row" className={rowClassName}>
      {content}
    </View>
  ) : (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID="delta-log-row"
      aria-label={rowLabel}
      // A button's name stands for its content, so the change itself rides as its description.
      {...describedBy(
        description.map((part) => part.id),
        description.map((part) => part.text).join(', '),
      )}
      className={cn(
        rowClassName,
        'active:bg-tint-press',
        // Inset: an outside ring clips in the scroller a row sits in.
        Platform.select({
          web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring',
        }),
      )}
    >
      {content}
    </Pressable>
  )
  // One tree with or without a footer: re-parenting the row would remount its button and drop focus.
  return (
    <View className={className}>
      {row}
      {hasFooter ? (
        <View className="flex-row gap-2.5 px-row-x-md pb-row-y-md">
          <OpBadge op={delta.op} label={opLabel} spacer />
          <View className="min-w-0 flex-1">{footer}</View>
        </View>
      ) : null}
    </View>
  )
}

export type { Delta, DeltaLogRowProps, DeltaOp, DeltaSource }
