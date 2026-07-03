import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import { emptyWorkingState, type WizardWorkingState } from '@/lib/db'

type WizardSnapshot = {
  state: WizardWorkingState
}

type WizardState = WizardSnapshot & {
  setStep: (step: number) => void
  patchDefinition: (patch: Partial<WizardWorkingState['definition']>) => void
  patchOpening: (patch: Partial<WizardWorkingState['opening']>) => void
  setLeadName: (leadName: string) => void
  hydrate: (state: WizardWorkingState) => void
  reset: () => void
}

const store = createStore<WizardState>()((set) => ({
  state: emptyWorkingState(),
  setStep: (step) => set((s) => ({ state: { ...s.state, step } })),
  patchDefinition: (patch) =>
    set((s) => ({ state: { ...s.state, definition: { ...s.state.definition, ...patch } } })),
  patchOpening: (patch) =>
    set((s) => ({ state: { ...s.state, opening: { ...s.state.opening, ...patch } } })),
  setLeadName: (leadName) => set((s) => ({ state: { ...s.state, leadName } })),
  hydrate: (state) => set({ state }),
  reset: () => set({ state: emptyWorkingState() }),
}))

function useWizard<T>(selector: (s: WizardSnapshot) => T): T {
  return useStore(store, selector as (s: WizardState) => T)
}

function getWizard(): WizardSnapshot {
  return { state: store.getState().state }
}

const api = store.getState()
export const wizardStore = {
  useWizard,
  getWizard,
  setStep: api.setStep,
  patchDefinition: api.patchDefinition,
  patchOpening: api.patchOpening,
  setLeadName: api.setLeadName,
  hydrate: api.hydrate,
  reset: api.reset,
  subscribe: store.subscribe,
}

export type { WizardSnapshot, WizardState }
