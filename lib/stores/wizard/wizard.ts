import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

import {
  emptyCastDraft,
  emptyWorkingState,
  type WizardCastDraft,
  type WizardCastDraftPatch,
  type WizardWorkingState,
  type WizardLoreDraft,
} from '@/lib/db'
import { generateId, type SubstitutablePrefix } from '@/lib/ids'

export const CAST_ID_PREFIX = {
  character: 'char',
  location: 'loc',
  item: 'item',
  faction: 'fact',
} as const satisfies Record<WizardCastDraft['kind'], SubstitutablePrefix>

type WizardSnapshot = {
  state: WizardWorkingState
  // Furthest step reached this session — drives which pills can be jumped to
  // forward. Ephemeral nav state, deliberately not part of the persisted
  // working-state blob; a resumed draft seeds it from its saved step.
  furthestStep: number
  // The custom effective-dim input currently holds something unparseable. Also
  // ephemeral: only a VALID dim ever reaches `state.effectiveDim`, so this flag is
  // what tells Finish the field disagrees with the value it would commit.
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
  /** Returns the minted row's id so a caller (e.g. an "expand on add" UI) can target it without reaching back into store state. */
  addLore: () => string
  patchLore: (id: string, patch: Partial<Omit<WizardLoreDraft, 'id'>>) => void
  removeLore: (id: string) => void
  importLore: (rows: readonly Partial<Omit<WizardLoreDraft, 'id'>>[]) => void
  /** Returns the minted row's id — same rationale as addLore. */
  addCast: (kind: WizardCastDraft['kind']) => string
  patchCast: (id: string, patch: WizardCastDraftPatch) => void
  importCast: (rows: readonly WizardCastDraft[]) => void
  /** Returns whether the lead was cascaded off (staged can't hold the lead) — caller toasts. */
  setCastStatus: (id: string, status: 'active' | 'staged') => boolean
  /** Returns whether the removed row was the lead — caller toasts. */
  removeCast: (id: string) => boolean
  hydrate: (state: WizardWorkingState) => void
  reset: () => void
}

function emptyLoreDraft(): WizardLoreDraft {
  return {
    id: generateId('lore'),
    title: '',
    body: '',
    category: '',
    tags: [],
    injectionMode: 'auto',
    priority: 0,
  }
}

// Every array-shaped field of the working state qualifies as a collection —
// derived from WizardWorkingState itself so a factory call can never target a
// key whose element type doesn't match the generic it's instantiated with.
type CollectionKey = {
  [K in keyof WizardWorkingState]: WizardWorkingState[K] extends readonly { id: string }[]
    ? K
    : never
}[keyof WizardWorkingState]

const store = createStore<WizardState>()((set) => {
  const fresh = emptyWorkingState()

  // Cascades that also touch leadEntityId stay bespoke below because they must
  // read+write in one set() call.
  function collectionMutators<K extends CollectionKey>(key: K) {
    type T = WizardWorkingState[K][number]
    const rows = (state: WizardWorkingState): readonly T[] => state[key]
    const withRows = (state: WizardWorkingState, next: readonly T[]): WizardWorkingState => ({
      ...state,
      [key]: next,
    })
    return {
      append: (added: readonly T[]) =>
        set((s) => ({ state: withRows(s.state, [...rows(s.state), ...added]) })),
      patch: (id: string, patch: Partial<T>) =>
        set((s) => ({
          state: withRows(
            s.state,
            rows(s.state).map((r) => (r.id === id ? ({ ...r, ...patch } as T) : r)),
          ),
        })),
      remove: (id: string) =>
        set((s) => ({
          state: withRows(
            s.state,
            rows(s.state).filter((r) => r.id !== id),
          ),
        })),
    }
  }

  const loreOps = collectionMutators('lore')
  const castOps = collectionMutators('cast')

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
    addLore: () => {
      const row = emptyLoreDraft()
      loreOps.append([row])
      return row.id
    },
    patchLore: (id, patch) => loreOps.patch(id, patch),
    removeLore: (id) => loreOps.remove(id),
    importLore: (rows) => loreOps.append(rows.map((row) => ({ ...emptyLoreDraft(), ...row }))),
    addCast: (kind) => {
      const row = emptyCastDraft(kind, generateId(CAST_ID_PREFIX[kind]))
      castOps.append([row])
      return row.id
    },
    // An id-keyed patch can't discriminate kind, so a cross-kind field would land
    // at runtime; the schema re-parse on load is the backstop.
    patchCast: (id, patch) => castOps.patch(id, patch),
    // Caller owns id uniqueness — unlike importLore, this can't re-mint ids
    // because the resolver's minted ids carry cross-references; a duplicate
    // would make one patchCast mutate both rows.
    importCast: (rows) => castOps.append(rows),
    // Cascades read leadEntityId in the same set() the row change lands in, so the
    // two can never be observed half-applied. The boolean tells the CALLER to
    // toast — stores stay toast-free.
    setCastStatus: (id, status) => {
      let leadUnset = false
      set((s) => {
        const found = s.state.cast.some((r) => r.id === id)
        leadUnset = found && status === 'staged' && s.state.leadEntityId === id
        return {
          state: {
            ...s.state,
            cast: s.state.cast.map((r) => (r.id === id ? { ...r, status } : r)),
            leadEntityId: leadUnset ? null : s.state.leadEntityId,
          },
        }
      })
      return leadUnset
    },
    removeCast: (id) => {
      let leadUnset = false
      set((s) => {
        leadUnset = s.state.leadEntityId === id
        // Prunes the two inbound-ref sites this array owns (factionId,
        // parentLocationId) so a removed faction/parent doesn't leave a dangling
        // pointer at commit time (no-harmless-id-leaks). opening.sceneEntities and
        // opening.currentLocationId are the other two inbound-ref sites — Finish's
        // active-row filter handles those.
        const cast = s.state.cast
          .filter((r) => r.id !== id)
          .map((r) => {
            if (r.kind === 'character' && r.factionId === id) return { ...r, factionId: null }
            if (r.kind === 'location' && r.parentLocationId === id)
              return { ...r, parentLocationId: null }
            return r
          })
        return {
          state: { ...s.state, cast, leadEntityId: leadUnset ? null : s.state.leadEntityId },
        }
      })
      return leadUnset
    },
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
  addLore: api.addLore,
  patchLore: api.patchLore,
  removeLore: api.removeLore,
  importLore: api.importLore,
  addCast: api.addCast,
  patchCast: api.patchCast,
  importCast: api.importCast,
  setCastStatus: api.setCastStatus,
  removeCast: api.removeCast,
  hydrate: api.hydrate,
  reset: api.reset,
  subscribe: store.subscribe,
}

export type { WizardSnapshot, WizardState }
