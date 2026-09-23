import { useEffect, useState } from 'react'

import type { PlotSelection } from './plot-selection'

/**
 * A deep link's one-shot effect: `reveal` fires once, on the first commit where `ready` is true
 * (panes mounted). Until then the link is returned, so only that mount can open on its tab.
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
