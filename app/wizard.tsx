import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Platform } from 'react-native'

import { finishWizard } from '@/components/wizard/finish'
import { StepCalendar } from '@/components/wizard/step-calendar'
import { StepFrame } from '@/components/wizard/step-frame'
import { StepOpening } from '@/components/wizard/step-opening'
import {
  canJumpToStep,
  stepForwardValid,
  type StepValidityParams,
} from '@/components/wizard/wizard-nav-logic'
import { WizardShell } from '@/components/wizard/wizard-shell'
import { saveLiveSession, saveStoryDraft } from '@/lib/actions'
import { DEFAULT_CALENDAR_ID, getCalendar } from '@/lib/calendar'
import { db, emptyWorkingState, runInTransaction } from '@/lib/db'
import { t } from '@/lib/i18n'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { runAction } from '@/lib/utils'

const ctx = { db, runInTransaction }

const AUTOSAVE_DEBOUNCE_MS = 500
const EMPTY_STATE_JSON = JSON.stringify(emptyWorkingState())

const FINISH_REASON_KEY = {
  title: 'wizard:finish.missing.title',
  opening: 'wizard:finish.missing.opening',
  lead: 'wizard:finish.missing.lead',
} as const

export default function WizardRoute() {
  const router = useRouter()
  const { draftId } = useLocalSearchParams<{ draftId?: string }>()
  const [sourceDraftId] = useState<string | null>(() =>
    typeof draftId === 'string' ? draftId : null,
  )

  const step = wizardStore.useWizard((s) => s.state.step)
  const furthestStep = wizardStore.useWizard((s) => s.furthestStep)
  const mode = wizardStore.useWizard((s) => s.state.definition.mode)
  const narration = wizardStore.useWizard((s) => s.state.definition.narration)
  const leadName = wizardStore.useWizard((s) => s.state.leadName)
  const calendarSystemId = wizardStore.useWizard((s) => s.state.definition.calendarSystemId)
  const worldTimeOrigin = wizardStore.useWizard((s) => s.state.definition.worldTimeOrigin)

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

  // Auto-save mirror (wizard.md → Save/cancel/draft semantics): every store
  // change debounces a saveLiveSession write so Next/Back/pill nav and field
  // edits survive a restart. Gated on "not the pristine default" rather than
  // "skip callback #1" — a lone Next click from step 1 is itself the first
  // meaningful change and must persist, so counting invocations would drop it.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const autosaveSuppressedRef = useRef(false)
  useEffect(() => {
    const unsubscribe = wizardStore.subscribe((s) => {
      // Always clear first: a field toggled away and back to its default
      // (net no-op) must cancel an already-scheduled write from the
      // intermediate change, not just skip scheduling a new one.
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      if (autosaveSuppressedRef.current) return
      if (JSON.stringify(s.state) === EMPTY_STATE_JSON) return
      autosaveTimerRef.current = setTimeout(() => {
        runAction(
          saveLiveSession(
            wizardStore.getWizard().state,
            ctx,
            undefined,
            sourceDraftId ?? undefined,
          ),
          {
            event: 'action_layer.wizard_autosave_failed',
          },
        )
      }, AUTOSAVE_DEBOUNCE_MS)
    })
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      unsubscribe()
    }
  }, [sourceDraftId])

  // Once Finish / Save-as-draft starts, an in-flight debounce timer must not
  // fire — it would recreate a stale 'live' row just after clearLiveSession.
  const suppressAutosave = () => {
    autosaveSuppressedRef.current = true
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
  }
  // A failed Finish / Save-as-draft already cancelled the pending autosave
  // debounce via suppressAutosave but committed nothing, so the user's last
  // edit would be lost. Re-enable and persist the current state now — the
  // failure path ran no clearLiveSession, so there's no race with it.
  const flushAutosave = () => {
    autosaveSuppressedRef.current = false
    if (JSON.stringify(wizardStore.getWizard().state) === EMPTY_STATE_JSON) return
    runAction(
      saveLiveSession(wizardStore.getWizard().state, ctx, undefined, sourceDraftId ?? undefined),
      { event: 'action_layer.wizard_autosave_failed' },
    )
  }

  const selectedCalendar = getCalendar(calendarSystemId) ?? getCalendar(DEFAULT_CALENDAR_ID)
  const validityParams: StepValidityParams = {
    mode,
    narration,
    leadName,
    worldTimeOrigin,
    calendar: selectedCalendar ?? null,
  }
  const canGoNext = stepForwardValid(step, validityParams)
  const canJumpTo = (target: number) => canJumpToStep(target, step, furthestStep, validityParams)

  // Finish commits a story; a double-tap before navigation would re-enter and
  // mint a second one. The ref gates re-entry synchronously (state flips a tick
  // late); `isFinishing` drives the button's disabled state for feedback.
  const finishingRef = useRef(false)
  const [isFinishing, setIsFinishing] = useState(false)

  const finish = () => {
    if (finishingRef.current) return
    finishingRef.current = true
    setIsFinishing(true)
    suppressAutosave()
    const { defaultStorySettings, embeddingModelId } = appSettingsStore.getAppSettings()
    runAction(
      finishWizard(
        wizardStore.getWizard().state,
        ctx,
        (branchId) => router.replace(`/reader-composer/${branchId}` as Href),
        { defaultStorySettings, embeddingModelId },
        undefined,
        sourceDraftId ?? undefined,
      )
        .then((result) => {
          if (result.status === 'ok') {
            wizardStore.reset()
            // Route unmounts (subscriber gone) and the store is pristine.
            autosaveSuppressedRef.current = false
            return
          }
          const fields = result.reasons
            .map((reason) => t(FINISH_REASON_KEY[reason as keyof typeof FINISH_REASON_KEY]))
            .join(', ')
          toast.error(t('wizard:finish.invalidList', { fields }))
          flushAutosave()
        })
        .catch((err) => {
          flushAutosave()
          throw err
        })
        .finally(() => {
          finishingRef.current = false
          setIsFinishing(false)
        }),
      {
        event: 'action_layer.wizard_finish_failed',
        toastMessage: t('wizard:finish.failed'),
      },
    )
  }

  const saveDraft = () => {
    suppressAutosave()
    runAction(
      saveStoryDraft(wizardStore.getWizard().state, ctx, undefined, sourceDraftId ?? undefined)
        .then(() => {
          wizardStore.reset()
          autosaveSuppressedRef.current = false
          router.back()
        })
        .catch((err) => {
          flushAutosave()
          throw err
        }),
      {
        event: 'action_layer.wizard_save_draft_failed',
        toastMessage: t('wizard:errors.saveDraftFailed'),
      },
    )
  }

  return (
    <WizardShell
      step={step}
      canGoNext={canGoNext}
      isFinish={step === 5}
      busy={isFinishing}
      onCancel={() => router.back()}
      onBack={goBack}
      onNext={step === 5 ? finish : goNext}
      onSaveDraft={saveDraft}
      onJump={(s) => wizardStore.setStep(s)}
      canJumpTo={canJumpTo}
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
