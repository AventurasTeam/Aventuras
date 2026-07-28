import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { emptyWorkingState, type WizardWorkingState } from '@/lib/db'

type WizardSnapshot = {
  state: WizardWorkingState
  // Furthest step reached this session — drives which pills can be jumped to
  // forward. Ephemeral nav state, deliberately not part of the persisted
  // working-state blob; a resumed draft seeds it from its saved step.
  furthestStep: number
  // The custom effective-dim input currently holds something unparseable. Also
  // ephemeral: only a VALID dim ever reaches `state.effectiveDim`, so without
  // this the last good value silently committed while the field showed an
  // error, and the Finish gate's `effectiveDim` reason was unreachable.
  customDimInvalid: boolean
}

type WizardState = WizardSnapshot & {
  setStep: (step: number) => void
  patchDefinition: (patch: Partial<WizardWorkingState['definition']>) => void
  patchOpening: (patch: Partial<WizardWorkingState['opening']>) => void
  setLeadName: (leadName: string) => void
  setLeadEntityId: (leadEntityId: string | null) => void
  setEffectiveDim: (effectiveDim: number | null) => void
  setCustomDimInvalid: (invalid: boolean) => void
  hydrate: (state: WizardWorkingState) => void
  reset: () => void
}

const store = createStore<WizardState>()((set) => {
  const fresh = emptyWorkingState()
  return {
    state: fresh,
    furthestStep: fresh.step,
    customDimInvalid: false,
    setStep: (step) =>
      set((s) => ({ state: { ...s.state, step }, furthestStep: Math.max(s.furthestStep, step) })),
    patchDefinition: (patch) =>
      set((s) => ({ state: { ...s.state, definition: { ...s.state.definition, ...patch } } })),
    patchOpening: (patch) =>
      set((s) => ({ state: { ...s.state, opening: { ...s.state.opening, ...patch } } })),
    setLeadName: (leadName) => set((s) => ({ state: { ...s.state, leadName } })),
    setLeadEntityId: (leadEntityId) => set((s) => ({ state: { ...s.state, leadEntityId } })),
    setEffectiveDim: (effectiveDim) =>
      set((s) => ({
        state: { ...s.state, effectiveDim, effectiveDimTouched: true },
        customDimInvalid: false,
      })),
    setCustomDimInvalid: (customDimInvalid) => set({ customDimInvalid }),
    hydrate: (state) => set({ state, furthestStep: state.step, customDimInvalid: false }),
    reset: () => {
      const r = emptyWorkingState()
      set({ state: r, furthestStep: r.step, customDimInvalid: false })
    },
  }
})

function useWizard<T>(selector: (s: WizardSnapshot) => T): T {
  return useStore(store, selector as (s: WizardState) => T)
}

function getWizard(): WizardSnapshot {
  const s = store.getState()
  return { state: s.state, furthestStep: s.furthestStep, customDimInvalid: s.customDimInvalid }
}

const api = store.getState()
export const wizardStore = {
  useWizard,
  getWizard,
  setStep: api.setStep,
  patchDefinition: api.patchDefinition,
  patchOpening: api.patchOpening,
  setLeadName: api.setLeadName,
  setLeadEntityId: api.setLeadEntityId,
  setEffectiveDim: api.setEffectiveDim,
  setCustomDimInvalid: api.setCustomDimInvalid,
  hydrate: api.hydrate,
  reset: api.reset,
  subscribe: store.subscribe,
}

export type { WizardSnapshot, WizardState }
