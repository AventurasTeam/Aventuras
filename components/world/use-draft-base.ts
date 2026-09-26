import { useState } from 'react'

export type DraftBase<T> = { base: T; markSaved: (saved: T) => void }

/**
 * A dirty draft's committed base, for a Save's three-way diff: `current` while clean, frozen on
 * the first dirty render; after `markSaved`, the saved value, so a mid-Save edit stays dirty.
 */
export function useDraftBase<T>(dirty: boolean, current: T): DraftBase<T> {
  const [frozen, setFrozen] = useState<{ value: T } | null>(null)
  // Render-phase sync, the NumberInput idiom.
  if (dirty && frozen === null) setFrozen({ value: current })
  if (!dirty && frozen !== null) setFrozen(null)
  const markSaved = (saved: T) => setFrozen({ value: saved })
  return { base: frozen === null ? current : frozen.value, markSaved }
}
