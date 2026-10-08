import type { ReactNode } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { LeadTag } from '@/components/entity/lead-tag'
import { PlotIcon } from '@/components/plot/plot-icon'
import { Heading } from '@/components/ui/heading'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Tag, TAG_HIT_SLOP } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { isPlotKind } from '@/lib/list-modules'
import type { RailCategory } from '@/lib/reader-rail'
import { cn } from '@/lib/utils'

import type { PeekLead } from './peek-model'

export type PeekHeadProps = {
  kind: RailCategory
  name: string
  /** A thread's or happening's catalog icon key; other kinds take their kind glyph. */
  icon?: string | null
  recentlyClassified: boolean
  /** Characters only (`peekLeadOf`). */
  lead?: PeekLead
  /** Phone: the icon-only `←`. */
  leading?: ReactNode
  /** Desktop / tablet: the `×`. */
  trailing?: ReactNode
}

type LeadCandidate = Extract<PeekLead, { state: 'candidate' }>

function SetLeadAction({ lead }: { lead: LeadCandidate }) {
  const label = t('reader:peek.setLead')
  const reason = lead.disabledReason
  const disabled = reason != null || lead.pending
  return (
    <ReasonTooltip reason={reason}>
      <Pressable
        accessibilityRole="button"
        // WCAG 2.5.3: the accessible name still leads with the visible label.
        aria-label={reason != null ? t('common:disabledWithReason', { label, reason }) : label}
        aria-busy={lead.pending || undefined}
        accessibilityHint={reason}
        disabled={disabled}
        onPress={lead.onSetLead}
        hitSlop={TAG_HIT_SLOP}
        className={cn(
          'shrink-0 rounded-sm px-1',
          disabled
            ? 'opacity-50'
            : cn(
                'active:bg-tint-press',
                Platform.select({ web: 'cursor-pointer hover:bg-tint-hover' }),
              ),
        )}
      >
        <Text size="xs" className="font-medium underline decoration-dashed">
          {label}
        </Text>
      </Pressable>
    </ReasonTooltip>
  )
}

/** reader-composer.md → Peek drawer: kind glyph, name, recently-classified, then the lead slot. */
export function PeekHead({
  kind,
  name,
  icon,
  recentlyClassified,
  lead,
  leading,
  trailing,
}: PeekHeadProps) {
  return (
    <View
      testID="peek-head"
      className={cn(
        'flex-row items-center border-b border-border',
        // Mobile expression: the phone head sits flush after its ←; desktop pushes × to the end.
        leading != null
          ? 'justify-start gap-2 px-3 pb-2.5 pt-2'
          : 'justify-between gap-3 px-4 pb-2.5 pt-3',
      )}
    >
      {leading}
      <View className="min-w-0 shrink flex-row items-center gap-2">
        {isPlotKind(kind) ? <PlotIcon kind={kind} icon={icon} /> : <EntityKindIcon kind={kind} />}
        <Heading level={3} numberOfLines={1} className="min-w-0 shrink">
          {name}
        </Heading>
        {recentlyClassified ? (
          <Tag tone="recently-classified">{t('reader:peek.recentlyClassified')}</Tag>
        ) : null}
        {lead?.state === 'lead' ? <LeadTag label={lead.label} /> : null}
        {lead?.state === 'candidate' ? <SetLeadAction lead={lead} /> : null}
      </View>
      {trailing}
    </View>
  )
}
