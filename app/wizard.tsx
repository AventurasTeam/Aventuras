import { useIsFocused } from '@react-navigation/native'
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, Platform, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import {
  EmbedderGateBlocked,
  EmbedderGateUnresolved,
} from '@/components/wizard/embedder-gate-blocked'
import { finishWizard, type EmbedderGateBlockedReason } from '@/components/wizard/finish'
import { StepCalendar } from '@/components/wizard/step-calendar'
import { StepFrame } from '@/components/wizard/step-frame'
import { StepOpening } from '@/components/wizard/step-opening'
import { StepWorld } from '@/components/wizard/step-world'
import {
  canJumpToStep,
  nextActiveStep,
  prevActiveStep,
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
  effectiveDim: 'wizard:finish.missing.effectiveDim',
  lore: 'wizard:finish.missing.lore',
} as const

type GateState =
  | { status: 'pending' }
  | { status: 'ok' }
  | { status: 'blocked'; reason: EmbedderGateBlockedReason; backend: 'local' | 'provider' }
  | { status: 'unresolved'; message: string }

async function resolveEntryGate(): Promise<GateState> {
  const { embeddingModelId, embeddingProviderId, defaultStorySettings, providers } =
    appSettingsStore.getAppSettings()

  // "Couldn't determine what's installed" is not "nothing is installed": the
  // latter tells the user to install a model they may already have, and none of
  // the real causes (preload missing, EACCES on the embedders root) are fixed
  // that way. A gate that can't answer must fail closed on its own surface.
  let installedIds: string[]
  try {
    installedIds = (await listInstalledLocal()).map((model) => model.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error('embedder.list_installed_failed', { error: message })
    return { status: 'unresolved', message }
  }

  const result = resolveEmbedderGate(
    { embeddingModelId, embeddingProviderId, defaultStorySettings, providers },
    installedIds,
  )
  return result.usable
    ? { status: 'ok' }
    : { status: 'blocked', reason: result.reason, backend: result.backend }
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
  const lore = wizardStore.useWizard((s) => s.state.lore)

  const goNext = () => wizardStore.setStep(nextActiveStep(step))
  const goBack = () => wizardStore.setStep(prevActiveStep(step))

  // Entry hard gate (wizard.md → Embedder-unavailable): no usable embedder blocks
  // the wizard outright. Focus-aware so returning from Settings (having fixed the
  // embedder) re-checks; the `cancelled` guard drops a stale in-flight resolve.
  const [gate, setGate] = useState<GateState>({ status: 'pending' })
  const [embedFailure, setEmbedFailure] = useState<{
    kind: 'init' | 'call'
    message: string
  } | null>(null)
  const isFocused = useIsFocused()
  const gateRunRef = useRef(0)
  const runEntryGate = useCallback(() => {
    const run = ++gateRunRef.current
    setGate({ status: 'pending' })
    void resolveEntryGate()
      .then((next) => {
        if (gateRunRef.current === run) setGate(next)
      })
      .catch((err: unknown) => {
        // Fail closed: leaving `gate` at 'pending' renders no modal at all,
        // silently turning the hard gate into no gate.
        const message = err instanceof Error ? err.message : String(err)
        logger.error('embedder.gate_resolve_failed', { error: message })
        if (gateRunRef.current === run) setGate({ status: 'unresolved', message })
      })
  }, [])

  useFocusEffect(
    useCallback(() => {
      // A fixed embedder must not leave a stale Finish-failure card on step 5.
      setEmbedFailure(null)
      runEntryGate()
      return () => {
        // Bump the run id so an in-flight resolve can't land after blur.
        gateRunRef.current += 1
      }
    }, [runEntryGate]),
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
    lore,
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
    // Only a valid dim ever reaches the working state, so finishWizard cannot
    // see an unparseable custom entry — it would commit the last good value
    // while the field showed an error. The flag is the draft's own verdict.
    if (wizardStore.getWizard().customDimInvalid) {
      toast.error(t('wizard:finish.invalidList', { fields: t(FINISH_REASON_KEY.effectiveDim) }))
      return
    }
    finishingRef.current = true
    setIsFinishing(true)
    setEmbedFailure(null)
    suppressAutosave()
    const {
      defaultStorySettings,
      embeddingModelId,
      embeddingProviderId,
      defaultSuggestionCategories,
      providers,
    } = appSettingsStore.getAppSettings()
    runAction(
      // A listing failure rejects rather than reporting "nothing installed":
      // runAction's toast is honest, whereas an empty list would block Finish
      // with model-not-installed and send the user to reinstall what they have.
      listInstalledLocal()
        .then((models) => models.map((model) => model.id))
        .then((installedLocalIds) =>
          finishWizard(
            wizardStore.getWizard().state,
            ctx,
            (branchId) => router.replace(`/reader-composer/${branchId}` as Href),
            {
              defaultStorySettings,
              embeddingModelId,
              embeddingProviderId,
              defaultSuggestionCategories,
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
            setGate({ status: 'blocked', reason: result.reason, backend: result.backend })
            flushAutosave()
            return
          }
          setEmbedFailure({ kind: result.kind, message: result.message })
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

  // No screen swap while the gate resolves: an early-returned placeholder
  // flashed an unthemed fullscreen view before the shell mounted. The shell
  // renders immediately and the blocked modal lands over it once the check
  // settles — the gate stays hard (Finish re-checks, and every modal exit
  // leaves the wizard).
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
      ) : step === 3 ? (
        <StepWorld onSetupAssist={() => router.push('/settings' as Href)} />
      ) : (
        <>
          <StepOpening onSetupAssist={() => router.push('/settings' as Href)} />
          {embedFailure && (
            <View className="mt-4 gap-3 rounded-md border border-danger bg-bg-base p-4">
              <Text className="text-sm font-medium text-danger">
                {t('wizard:finish.embedFailed.title')}
              </Text>
              <Text className="text-sm text-fg-secondary">
                {t(`wizard:finish.embedFailed.${embedFailure.kind}` as const)}
              </Text>
              <Text size="xs" variant="muted">
                {t('embedder:failure.technicalDetail')}
              </Text>
              <Text size="xs" className="font-mono text-fg-secondary">
                {embedFailure.message}
              </Text>
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
      {/* Portaled to the app root, so it would float above a pushed Settings
          screen — the wizard stays mounted underneath. Render only while this
          screen is focused. */}
      {gate.status === 'blocked' && isFocused ? (
        <EmbedderGateBlocked reason={gate.reason} backend={gate.backend} />
      ) : null}
      {gate.status === 'unresolved' && isFocused ? (
        <EmbedderGateUnresolved message={gate.message} onRetry={runEntryGate} />
      ) : null}
    </WizardShell>
  )
}
