import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { EmbedderGateBlocked } from '@/components/wizard/embedder-gate-blocked'
import { finishWizard, type EmbedderGateBlockedReason } from '@/components/wizard/finish'
import { StepCalendar } from '@/components/wizard/step-calendar'
import { StepFrame } from '@/components/wizard/step-frame'
import { StepOpening } from '@/components/wizard/step-opening'
import {
  canJumpToStep,
  stepForwardValid,
  type StepValidityParams,
} from '@/components/wizard/wizard-nav-logic'
import { WizardShell } from '@/components/wizard/wizard-shell'
import { clearLiveSession, saveLiveSession, saveStoryDraft } from '@/lib/actions'
import { DEFAULT_CALENDAR_ID, getCalendar } from '@/lib/calendar'
import { db, emptyWorkingState, execRaw, runInTransaction } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { listInstalledLocal, resolveEmbedderGate } from '@/lib/embedder'
import { t } from '@/lib/i18n'
import { appSettingsStore, wizardStore } from '@/lib/stores'
import { toast } from '@/lib/toast'
import { runAction } from '@/lib/utils'

const ctx = { db, runInTransaction }

// The embed step's store-coupled seams (finish.ts stays store-free): raw DDL exec
// and provider-instance lookup from the live app-settings snapshot.
const embedCtx = {
  exec: execRaw,
  resolveProvider: (providerId: string) =>
    appSettingsStore.getAppSettings().providers.find((p) => p.id === providerId),
}

const AUTOSAVE_DEBOUNCE_MS = 500
const EMPTY_STATE_JSON = JSON.stringify(emptyWorkingState())

const FINISH_REASON_KEY = {
  title: 'wizard:finish.missing.title',
  opening: 'wizard:finish.missing.opening',
  lead: 'wizard:finish.missing.lead',
} as const

type GateState =
  | { status: 'pending' }
  | { status: 'ok' }
  | { status: 'blocked'; reason: EmbedderGateBlockedReason }

// A listing blip must degrade to "nothing installed" so it surfaces through the
// embedder gate (model-not-installed), not a generic finish-failed toast.
async function listInstalledLocalIds(): Promise<string[]> {
  try {
    return (await listInstalledLocal()).map((model) => model.id)
  } catch (err) {
    logger.warn('embedder.list_installed_failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

async function resolveEntryGate(): Promise<GateState> {
  const { embeddingModelId, embeddingProviderId, defaultStorySettings, providers } =
    appSettingsStore.getAppSettings()
  const installedIds = await listInstalledLocalIds()
  const result = resolveEmbedderGate(
    { embeddingModelId, embeddingProviderId, defaultStorySettings, providers },
    installedIds,
  )
  return result.usable ? { status: 'ok' } : { status: 'blocked', reason: result.reason }
}

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

  // Entry hard gate (wizard.md → Embedder-unavailable): no usable embedder blocks
  // the wizard outright. Focus-aware so returning from Settings (having fixed the
  // embedder) re-checks; the `cancelled` guard drops a stale in-flight resolve.
  const [gate, setGate] = useState<GateState>({ status: 'pending' })
  const [embedFailure, setEmbedFailure] = useState<{ message: string } | null>(null)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false
      // A fixed embedder must not leave a stale Finish-failure card on step 5.
      setEmbedFailure(null)
      setGate({ status: 'pending' })
      void resolveEntryGate().then((next) => {
        if (!cancelled) setGate(next)
      })
      return () => {
        cancelled = true
      }
    }, []),
  )

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
    setEmbedFailure(null)
    suppressAutosave()
    const { defaultStorySettings, embeddingModelId, embeddingProviderId, providers } =
      appSettingsStore.getAppSettings()
    runAction(
      listInstalledLocalIds()
        .then((installedLocalIds) =>
          finishWizard(
            wizardStore.getWizard().state,
            ctx,
            (branchId) => router.replace(`/reader-composer/${branchId}` as Href),
            {
              defaultStorySettings,
              embeddingModelId,
              embeddingProviderId,
              providers,
              installedLocalIds,
            },
            embedCtx,
            undefined,
            sourceDraftId ?? undefined,
          ),
        )
        .then((result) => {
          if (result.status === 'ok') {
            wizardStore.reset()
            // Route unmounts (subscriber gone) and the store is pristine.
            autosaveSuppressedRef.current = false
            return
          }
          if (result.status === 'invalid') {
            const fields = result.reasons
              .map((reason) => t(FINISH_REASON_KEY[reason as keyof typeof FINISH_REASON_KEY]))
              .join(', ')
            toast.error(t('wizard:finish.invalidList', { fields }))
            flushAutosave()
            return
          }
          if (result.status === 'embed-blocked') {
            // The embedder was removed mid-session; drop back to the entry-gate
            // surface (same rendering) so the fix path is the settings route.
            setGate({ status: 'blocked', reason: result.reason })
            flushAutosave()
            return
          }
          setEmbedFailure({ message: result.message })
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

  // Embed-failure Cancel (wizard.md → Embedder-unavailable): abandons the wizard
  // and clears the auto-saved session — unlike the chrome ← Cancel, which
  // preserves it. Uses the existing clear-session action; a resumed draft's
  // stories row is left intact (no draft-delete action exists yet).
  const cancelAfterEmbedFailure = () => {
    suppressAutosave()
    runAction(
      clearLiveSession(ctx).then(() => {
        wizardStore.reset()
        autosaveSuppressedRef.current = false
        router.back()
      }),
      {
        event: 'action_layer.wizard_live_session_cleanup_failed',
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

  if (gate.status === 'pending') {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
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
        <>
          <StepOpening onSetupAssist={() => router.push('/settings' as Href)} />
          {embedFailure && (
            <View className="mt-4 gap-3 rounded-md border border-danger bg-bg-base p-4">
              <Text className="text-sm font-medium text-danger">
                {t('wizard:finish.embedFailed.title')}
              </Text>
              <Text className="text-sm text-fg-secondary">{embedFailure.message}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button size="sm" onPress={finish} loading={isFinishing}>
                  <Text>{t('wizard:finish.embedFailed.retry')}</Text>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => router.push('/settings?tab=memory' as Href)}
                >
                  <Text>{t('wizard:finish.embedFailed.openSettings')}</Text>
                </Button>
                <Button size="sm" variant="ghost" onPress={cancelAfterEmbedFailure}>
                  <Text>{t('wizard:finish.embedFailed.cancel')}</Text>
                </Button>
              </View>
            </View>
          )}
        </>
      )}
      {gate.status === 'blocked' ? <EmbedderGateBlocked reason={gate.reason} /> : null}
    </WizardShell>
  )
}
