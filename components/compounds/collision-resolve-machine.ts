import { normalizeTerm } from '@/lib/keyword-terms'

import type { ScalarField } from './collision-resolve-diff'

export type MergeState = {
  canonicalId: string
  /** Fields the merged row takes from the non-canonical row; every other one keeps the canonical's. */
  fromOther: ReadonlySet<ScalarField>
  deselectedTags: string[]
  /** `normalizeTerm` keys: a chip's spelling follows the canonical, the deselect follows the keyword. */
  deselectedKeywords: string[]
}

export type MergeAction =
  | { type: 'pick-canonical'; id: string }
  | { type: 'pick-field'; field: ScalarField; fromOther: boolean }
  | { type: 'toggle-tag'; tag: string }
  | { type: 'toggle-keyword'; keyword: string }
  | { type: 'reset'; defaultCanonicalId: string }

const NONE: ReadonlySet<ScalarField> = new Set()

export function initMergeState(defaultCanonicalId: string): MergeState {
  return {
    canonicalId: defaultCanonicalId,
    fromOther: NONE,
    deselectedTags: [],
    deselectedKeywords: [],
  }
}

export function mergeReducer(state: MergeState, action: MergeAction): MergeState {
  switch (action.type) {
    case 'pick-canonical': {
      // Both deselect sets are kept: chip choices are independent of the pick.
      return { ...state, canonicalId: action.id, fromOther: NONE }
    }
    case 'pick-field': {
      const fromOther = new Set(state.fromOther)
      if (action.fromOther) fromOther.add(action.field)
      else fromOther.delete(action.field)
      return { ...state, fromOther }
    }
    case 'toggle-tag': {
      const has = state.deselectedTags.includes(action.tag)
      return {
        ...state,
        deselectedTags: has
          ? state.deselectedTags.filter((t) => t !== action.tag)
          : [...state.deselectedTags, action.tag],
      }
    }
    case 'toggle-keyword': {
      const key = normalizeTerm(action.keyword)
      const has = state.deselectedKeywords.includes(key)
      return {
        ...state,
        deselectedKeywords: has
          ? state.deselectedKeywords.filter((k) => k !== key)
          : [...state.deselectedKeywords, key],
      }
    }
    case 'reset': {
      return initMergeState(action.defaultCanonicalId)
    }
  }
}
