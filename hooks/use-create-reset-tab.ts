import { useState } from 'react'

/** A new `[+] Blank` (create `seq`) lands on `createTab`, whichever tab the previous row was on. */
export function useCreateResetTab<Tab extends string>(
  createSeq: number | undefined,
  createTab: Tab,
  openingTab: Tab,
) {
  const [tab, setTab] = useState<Tab>(openingTab)
  // Synced during render so a new create draft never paints a frame on the previous tab.
  const [seenSeq, setSeenSeq] = useState(createSeq)
  if (createSeq !== seenSeq) {
    setSeenSeq(createSeq)
    if (createSeq != null) setTab(createTab)
  }
  return [tab, setTab] as const
}
