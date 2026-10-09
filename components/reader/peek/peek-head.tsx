import { ArrowLeft, X } from 'lucide-react-native'
import { Platform, Pressable, View } from 'react-native'

import { EntityKindIcon } from '@/components/entity/entity-kind-icon'
import { LeadTag } from '@/components/entity/lead-tag'
import { PlotIcon } from '@/components/plot/plot-icon'
import { Heading } from '@/components/ui/heading'
import { IconAction } from '@/components/ui/icon-action'
import { ReasonTooltip } from '@/components/ui/reason-tooltip'
import { Tag, TAG_HIT_SLOP } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import type { EntityKind } from '@/lib/db'
import { t } from '@/lib/i18n'
import type { PlotKind } from '@/lib/list-modules'
import { cn } from '@/lib/utils'

import { isLeadActionDisabled, type PeekLead } from './peek-model'

/** Desktop / tablet close with `×`; phone goes back to the rail Sheet's list with `←`. */
export type PeekChrome =
  | { kind: 'close'; onClose: () => void }
  | { kind: 'back'; onBack: () => void }

/** What the head shows for its kind: characters carry the lead affordance, plot rows their icon. */
export type PeekHeadIdentity =
  | { kind: 'character'; lead: PeekLead }
  | { kind: Exclude<EntityKind, 'character'> | 'lore' }
  | {
      kind: PlotKind
      /** The row's catalog key; `PlotIcon` falls back per kind. */
      icon: string | null
    }

export type PeekHeadProps = PeekHeadIdentity & {
  name: string
  recentlyClassified: boolean
  chrome: PeekChrome
}

type LeadCandidate = Extract<PeekLead, { state: 'candidate' }>

function SetLeadAction({ lead, isPhone }: { lead: LeadCandidate; isPhone: boolean }) {
  const label = t('reader:peek.setLead')
  const reason = lead.disabledReason
  const disabled = isLeadActionDisabled(lead)
  return (
    <ReasonTooltip reason={reason}>
      <Pressable
        accessibilityRole="button"
        // WCAG 2.5.3: the accessible name still leads with the visible label.
        aria-label={reason != null ? t('common:disabledWithReason', { label, reason }) : label}
        aria-busy={lead.pending || undefined}
        disabled={disabled}
        onPress={lead.onSetLead}
        hitSlop={TAG_HIT_SLOP}
        className={cn(
          'shrink-0 rounded-sm px-1',
          // touch.md floor: fill the phone head's 44px group (ReasonTooltip's web box, present with a reason, doesn't).
          isPhone && 'justify-center self-stretch',
          disabled
            ? 'opacity-50'
            : cn(
                'active:bg-tint-press',
                Platform.select({
                  web: 'cursor-pointer outline-none hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
                }),
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

/** reader-composer.md → Peek drawer. */
export function PeekHead(props: PeekHeadProps) {
  const { name, recentlyClassified, chrome } = props
  const isPhone = useTier() === 'phone'
  const back = chrome.kind === 'back'
  const lead = props.kind === 'character' ? props.lead : undefined
  return (
    <View
      testID="peek-head"
      className={cn(
        'flex-row items-center border-b border-border',
        // Mobile expression: the phone head sits flush after its ←; desktop pushes × to the end.
        back ? 'justify-start gap-2 px-3' : 'justify-between gap-3 px-4',
        // On phone the 44px group sets the height; elsewhere the head pads its own.
        !isPhone && (back ? 'pb-2.5 pt-2' : 'pb-2.5 pt-3'),
      )}
    >
      {chrome.kind === 'back' ? (
        <IconAction icon={ArrowLeft} label={t('reader:peek.back')} onPress={chrome.onBack} />
      ) : null}
      <View className={cn('min-w-0 shrink flex-row items-center gap-2', isPhone && 'min-h-[44px]')}>
        {props.kind === 'thread' || props.kind === 'happening' ? (
          <PlotIcon kind={props.kind} icon={props.icon} />
        ) : (
          <EntityKindIcon kind={props.kind} />
        )}
        <Heading level={3} numberOfLines={1} className="min-w-0 shrink">
          {name}
        </Heading>
        {recentlyClassified ? (
          <Tag tone="recently-classified">{t('reader:peek.recentlyClassified')}</Tag>
        ) : null}
        {lead?.state === 'lead' ? <LeadTag label={lead.label} /> : null}
        {lead?.state === 'candidate' ? <SetLeadAction lead={lead} isPhone={isPhone} /> : null}
      </View>
      {chrome.kind === 'close' ? (
        <IconAction icon={X} label={t('reader:peek.close')} onPress={chrome.onClose} />
      ) : null}
    </View>
  )
}
