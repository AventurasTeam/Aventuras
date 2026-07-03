import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import { BackHandler, Platform, View } from 'react-native'

import { Text } from '@/components/ui/text'
import { WizardShell } from '@/components/wizard/wizard-shell'
import { t } from '@/lib/i18n'
import { wizardStore } from '@/lib/stores'

function placeholderKey(step: number) {
  switch (step) {
    case 2:
      return 'wizard:placeholder.calendar' as const
    case 5:
      return 'wizard:placeholder.opening' as const
    default:
      return 'wizard:placeholder.frame' as const
  }
}

function StepBodyPlaceholder({ step }: { step: number }) {
  return (
    <View className="flex-1 items-center justify-center py-12">
      <Text variant="muted">{t(placeholderKey(step))}</Text>
    </View>
  )
}

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

  return (
    <WizardShell
      step={step}
      canGoNext={true /* per-step validity wires in Task 22 */}
      isFinish={step === 5}
      onCancel={() => router.back()}
      onBack={goBack}
      onNext={goNext}
      onSaveDraft={() => {
        // Task 22: wire the SQLite mirror + save-draft action.
      }}
      onJump={(s) => wizardStore.setStep(s)}
    >
      <StepBodyPlaceholder step={step} />
    </WizardShell>
  )
}
