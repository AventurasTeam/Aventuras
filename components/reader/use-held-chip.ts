import { useState } from 'react'

import type { BranchChipView } from './branch-navigator'

/** The chip the navigator opened with, while it stays open; the live chip otherwise. */
export function useHeldChip(chip: BranchChipView | null, open: boolean): BranchChipView | null {
  // Latched in the render `open` flips in, so that render already returns the held chip.
  const [latch, setLatch] = useState(() => ({ open, chip: open ? chip : null }))
  if (latch.open !== open) setLatch({ open, chip: open ? chip : null })
  if (!open) return chip
  return (latch.open ? latch.chip : chip) ?? chip
}
