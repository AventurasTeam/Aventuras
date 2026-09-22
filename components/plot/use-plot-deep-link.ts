import { useEffect, useState } from 'react'

import type { PlotSelection } from './plot-selection'

/**
 * A deep link's one-shot effects. `reveal` runs once, after the first commit with `ready`
 * (the panes mounted); the link is returned until then, so only the linked row's first pane
 * mount can open on its tab.
 */
export function usePlotDeepLink(
  link: PlotSelection | null,
  ready: boolean,
  reveal: (link: PlotSelection) => void,
): PlotSelection | null {
  const [pending, setPending] = useState(link != null)
  useEffect(() => {
    if (!pending || link == null || !ready) return
    setPending(false)
    reveal(link)
  }, [pending, link, ready, reveal])
  return pending ? link : null
}
