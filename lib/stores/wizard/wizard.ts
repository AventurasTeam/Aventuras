import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { emptyWorkingState, type WizardWorkingState } from '@/lib/db'

type WizardSnapshot = {
  state: WizardWorkingState
  // Furthest step reached this session — drives which pills can be jumped to
  // forward. Ephemeral nav state, deliberately not part of the persisted
  // working-state blob; a resumed draft seeds it from its saved step.
  furthestStep: number
}

type WizardState = WizardSnapshot & {
  setStep: (step: number) => void
  patchDefinition: (patch: Partial<WizardWorkingState['definition']>) => void
  patchOpening: (patch: Partial<WizardWorkingState['opening']>) => void
  setLeadName: (leadName: string) => void
  setLeadEntityId: (leadEntityId: string | null) => void
  hydrate: (state: WizardWorkingState) => void
  reset: () => void
}

const store = createStore<WizardState>()((set) => {
  const fresh = emptyWorkingState()
  return {
    state: fresh,
    furthestStep: fresh.step,
    setStep: (step) =>
      set((s) => ({ state: { ...s.state, step }, furthestStep: Math.max(s.furthestStep, step) })),
    patchDefinition: (patch) =>
      set((s) => ({ state: { ...s.state, definition: { ...s.state.definition, ...patch } } })),
    patchOpening: (patch) =>
      set((s) => ({ state: { ...s.state, opening: { ...s.state.opening, ...patch } } })),
    setLeadName: (leadName) => set((s) => ({ state: { ...s.state, leadName } })),
    setLeadEntityId: (leadEntityId) => set((s) => ({ state: { ...s.state, leadEntityId } })),
    hydrate: (state) => set({ state, furthestStep: state.step }),
    reset: () => {
      const r = emptyWorkingState()
      set({ state: r, furthestStep: r.step })
    },
  }
})

function useWizard<T>(selector: (s: WizardSnapshot) => T): T {
  return useStore(store, selector as (s: WizardState) => T)
}

function getWizard(): WizardSnapshot {
  const s = store.getState()
  return { state: s.state, furthestStep: s.furthestStep }
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
  hydrate: api.hydrate,
  reset: api.reset,
  subscribe: store.subscribe,
}

export type { WizardSnapshot, WizardState }
