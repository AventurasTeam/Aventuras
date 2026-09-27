import { useEffect, useState } from 'react'

import type { WorldSelection } from './world-selection'

/**
 * A deep link is one-shot: returned until the first commit where `ready` is true (panes mounted),
 * so only that mount opens on its tab, and a later remount of the same row lands on Overview.
 */
export function useWorldDeepLink(
  link: WorldSelection | null,
  ready: boolean,
): WorldSelection | null {
  const [pending, setPending] = useState(link != null)
  useEffect(() => {
    if (pending && link != null && ready) setPending(false)
  }, [pending, link, ready])
  return pending ? link : null
}
