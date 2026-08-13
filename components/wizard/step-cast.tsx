import { TriangleAlert } from 'lucide-react-native'
import { View } from 'react-native'

import { Heading } from '@/components/ui/heading'
import { Icon } from '@/components/ui/icon'
import { Text } from '@/components/ui/text'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'

import { CastList, type CastAssistSeams } from './cast-list'
import { activeLead } from './step-cast-logic'
import { needsLead } from './step-frame-logic'

export type StepCastProps = {
  /** "Set up in Settings" from the assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: CastAssistSeams
}

function LeadRequiredNotice({ reason }: { reason: 'mode' | 'narration' }) {
  return (
    <View
      role="status"
      aria-live="polite"
      className="flex-row items-start gap-2 rounded-r-md border-l-4 border-l-warning bg-bg-sunken px-3 py-2.5"
    >
      <Icon as={TriangleAlert} size="sm" className="mt-0.5 shrink-0 text-warning" />
      <Text size="sm" className="flex-1 text-fg-primary">
        {t(`wizard:cast.leadNotice.${reason}`)}
      </Text>
    </View>
  )
}

export function StepCast({ onSetupAssist, assist }: StepCastProps) {
  const definition = wizardStore.useWizard((s) => s.state.definition)
  const cast = wizardStore.useWizard((s) => s.state.cast)
  const leadEntityId = wizardStore.useWizard((s) => s.state.leadEntityId)

  const leadMissing =
    needsLead(definition.mode, definition.narration) && activeLead(cast, leadEntityId) == null

  return (
    <View className="gap-6">
      {/* Sole heading for the step — CastList's header row carries the two add
          affordances and no label of its own, so the same copy can't land at
          two heading levels. */}
      <Heading level={1}>{t('wizard:cast.heading')}</Heading>
      {leadMissing ? (
        // Both triggers can fire at once (adventure + first-person). Mode is the
        // stronger constraint and names the whole play pattern, so it wins.
        <LeadRequiredNotice reason={definition.mode === 'adventure' ? 'mode' : 'narration'} />
      ) : null}
      <CastList onSetupAssist={onSetupAssist} assist={assist} />
    </View>
  )
}
