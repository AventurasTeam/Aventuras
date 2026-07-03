import { useRouter, type Href } from 'expo-router'
import { useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'

import { finishWizard } from '@/components/wizard/finish'
import { StepCalendar } from '@/components/wizard/step-calendar'
import { StepFrame } from '@/components/wizard/step-frame'
import { StepOpening } from '@/components/wizard/step-opening'
import { WizardShell } from '@/components/wizard/wizard-shell'
import { db, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { runAction } from '@/lib/utils'

const ctx = { db, runInTransaction }

const FINISH_REASON_KEY = {
  title: 'wizard:finish.missing.title',
  opening: 'wizard:finish.missing.opening',
  lead: 'wizard:finish.missing.lead',
} as const

export default function WizardRoute() {
  const router = useRouter()
  const step = wizardStore.useWizard((s) => s.state.step)

  const goNext = () => wizardStore.setStep(step === 2 ? 5 : step + 1)
  const goBack = () => wizardStore.setStep(step === 5 ? 2 : step - 1)

  // OS back = Cancel (platform.md → OS back integration): Android hardware
  // back fires the same preserve-session-and-return-to-story-list semantics
  // as the chrome's ← Cancel button. iOS swipe-back is handled natively by
  // the Stack navigator's default gesture, which already pops to story-list.
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.back()
      return true
    })
    return () => sub.remove()
  }, [router])

  const finish = () => {
    const { defaultStorySettings, embeddingModelId } = appSettingsStore.getAppSettings()
    runAction(
      finishWizard(
        wizardStore.getWizard().state,
        ctx,
        (branchId) => router.replace(`/reader-composer/${branchId}` as Href),
        { defaultStorySettings, embeddingModelId },
      ).then((result) => {
        if (result.status === 'ok') {
          wizardStore.reset()
          return
        }
        const fields = result.reasons
          .map((reason) => t(FINISH_REASON_KEY[reason as keyof typeof FINISH_REASON_KEY]))
          .join(', ')
        toast.error(t('wizard:finish.invalidList', { fields }))
      }),
      {
        event: 'action_layer.wizard_finish_failed',
        toastMessage: t('wizard:finish.failed'),
      },
    )
  }

  return (
    <WizardShell
      step={step}
      canGoNext={true /* per-step validity wires in Task 22 */}
      isFinish={step === 5}
      onCancel={() => router.back()}
      onBack={goBack}
      onNext={step === 5 ? finish : goNext}
      onSaveDraft={() => {
        // Task 22: wire the SQLite mirror + save-draft action.
      }}
      onJump={(s) => wizardStore.setStep(s)}
    >
      {step === 1 ? (
        <StepFrame />
      ) : step === 2 ? (
        <StepCalendar />
      ) : (
        <StepOpening onSetupAssist={() => router.push('/settings' as Href)} />
      )}
    </WizardShell>
  )
}
