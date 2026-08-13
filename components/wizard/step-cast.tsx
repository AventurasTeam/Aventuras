import { View } from 'react-native'

import { Heading } from '@/components/ui/heading'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'

import { CastList, type CastAssistSeams } from './cast-list'
import { activeLead } from './step-cast-logic'
import { needsLead } from './step-frame-logic'
import { StepNotice } from './step-notice'

// Re-exported so a route wires the step's seam from the step's own module
// rather than reaching past it into the list.
export type { CastAssistSeams }

export type StepCastProps = {
  /** "Set up in Settings" from the assist's not-configured state. */
  onSetupAssist?: () => void
  assist?: CastAssistSeams
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
        <StepNotice
          message={t(
            definition.mode === 'adventure'
              ? 'wizard:cast.leadNotice.mode'
              : 'wizard:cast.leadNotice.narration',
          )}
        />
      ) : null}
      <CastList onSetupAssist={onSetupAssist} assist={assist} />
    </View>
  )
}
