import { useState } from 'react'

export type DraftBase<T> = { base: T; markSaved: (saved: T) => void }

/**
 * The committed value a dirty field's draft was based on, for a Save's three-way diff: `current`
 * while clean, frozen on the first dirty render; after `markSaved`, the saved value, so an edit
 * made during the Save stays dirty against what that Save wrote.
 */
export function useDraftBase<T>(dirty: boolean, current: T): DraftBase<T> {
  const [frozen, setFrozen] = useState<{ value: T } | null>(null)
  // Render-phase sync, the NumberInput idiom.
  if (dirty && frozen === null) setFrozen({ value: current })
  if (!dirty && frozen !== null) setFrozen(null)
  const markSaved = (saved: T) => setFrozen({ value: saved })
  return { base: frozen === null ? current : frozen.value, markSaved }
}
